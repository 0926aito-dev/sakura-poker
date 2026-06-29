/* =========================================================
   hand-engine.js
   ブラウザ(<script>タグ)とNode.js(require)の両方から
   同じロジックを使うための共有モジュールです。
   メンバーデータ・役判定・確率計算など、ゲーム本体・
   役エディター・サーバーで重複させたくない部分をここに集約します。
========================================================= */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.SakuraHandEngine = mod;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  /* メンバーデータは members.xlsx → members-data.js(自動生成) から読み込みます。
     Node(require)とブラウザ(<script>)の両方に対応した取得方法。 */
  const MEMBERS_DATA = (typeof module === "object" && module.exports)
    ? require("./members-data.js")
    : (typeof window !== "undefined" ? window.SAKURA_MEMBERS_DATA : globalThis.SAKURA_MEMBERS_DATA);

  const MEMBERS = MEMBERS_DATA || [];
  const ACTIVE_MEMBERS = MEMBERS.filter(m => m.status !== "graduated");
  const GRADUATED_MEMBERS = MEMBERS.filter(m => m.status === "graduated");

  /* デッキ構成: 1メンバーにつき4枚の物理カードが存在する(同名カードが4枚)。
     使用デッキは「在籍メンバーのみ」「全メンバー(卒業済みを含む)」の2種類。 */
  const COPIES_PER_MEMBER = 4;
  const DECKS = { active: ACTIVE_MEMBERS, all: MEMBERS };

  function buildDeck(pool) {
    const deck = [];
    for (const member of pool) {
      for (let i = 0; i < COPIES_PER_MEMBER; i++) deck.push(member);
    }
    return deck;
  }

  /* 五十音順(あ→ん)で頭文字を比較するための並び順 */
  const KANA_ORDER = [
    "あ", "い", "う", "え", "お",
    "か", "き", "く", "け", "こ",
    "さ", "し", "す", "せ", "そ",
    "た", "ち", "つ", "て", "と", "ど",
    "な", "に", "ぬ", "ね", "の",
    "は", "ひ", "ふ", "へ", "ほ",
    "ま", "み", "む", "め", "も",
    "や", "ゆ", "よ",
    "ら", "り", "る", "れ", "ろ",
    "わ", "ゐ", "ゑ", "を", "ん"
  ];

  /* メンバーを「期の昇順 → 名前の昇順(頭文字の五十音順、同じ頭文字なら文字列順)」で並べる */
  function sortMembers(members) {
    return [...members].sort((a, b) => {
      if (a.gen !== b.gen) return a.gen - b.gen;
      const ai = KANA_ORDER.indexOf(a.initial);
      const bi = KANA_ORDER.indexOf(b.initial);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name, "ja");
    });
  }

  const BASE_HANDS = [
    { id: "high", label: "ハイカード", type: "high" },
    { id: "genPair", label: "同期ペア", type: "gen", size: 2 },
    { id: "genTwoPair", label: "ダブル同期ペア", type: "genTwoPair" },
    { id: "genThree", label: "同期3枚", type: "gen", size: 3 },
    { id: "genFour", label: "同期4枚", type: "gen", size: 4 },
    { id: "genFive", label: "同期5枚", type: "gen", size: 5 }
  ];

  const MIN_CUSTOM_SIZE = 2;
  const MAX_CUSTOM_SIZE = 5;

  function countBy(array, key) {
    return array.reduce((acc, item) => {
      const value = item[key];
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = (result * (n - i)) / (i + 1);
    }
    return result;
  }

  /*
    オリジナル役の「枠(スロット)」は2種類:
      - { type:"name", value:"大園玲" }  … 特定の人を指名する枠(同じ人を最大4枚まで重複指定可)
      - { type:"gen",  value:2 }         … 「2期生の誰か」を指す属性ワイルドカード枠
      - { type:"group",value:"R" }       … 「グループRの誰か」を指す属性ワイルドカード枠
    属性ワイルドカード枠は1つの役の中で gen と group を混在させることはできません
    (確率計算を厳密に行うための制約)。
    旧形式(names配列のみ)のデータは自動的に name枠の配列として扱います。
  */
  function getHandSlots(handDef) {
    if (Array.isArray(handDef.slots) && handDef.slots.length > 0) return handDef.slots;
    if (Array.isArray(handDef.names)) return handDef.names.map(n => ({ type: "name", value: n }));
    return [];
  }

  function describeSlot(slot) {
    if (slot.type === "name") return slot.value;
    if (slot.type === "gen") return `${slot.value}期の誰か`;
    if (slot.type === "group") return `グループ${slot.value}の誰か`;
    return "?";
  }

  function validateSlotsAgainstPool(slots, pool) {
    if (!Array.isArray(slots) || slots.length < MIN_CUSTOM_SIZE || slots.length > MAX_CUSTOM_SIZE) {
      return false;
    }

    const nameCounts = {};
    const attrTypesUsed = new Set();

    for (const slot of slots) {
      if (!slot || typeof slot !== "object") return false;

      if (slot.type === "name") {
        if (typeof slot.value !== "string") return false;
        nameCounts[slot.value] = (nameCounts[slot.value] || 0) + 1;
        if (nameCounts[slot.value] > COPIES_PER_MEMBER) return false;
        if (!pool.some(m => m.name === slot.value)) return false;
      } else if (slot.type === "gen" || slot.type === "group") {
        if (!pool.some(m => m[slot.type] === slot.value)) return false;
        attrTypesUsed.add(slot.type);
      } else {
        return false;
      }
    }

    if (attrTypesUsed.size > 1) return false; // gen枠とgroup枠の混在は不可

    return true;
  }

  function isValidSlots(slots) {
    return validateSlotsAgainstPool(slots, MEMBERS);
  }

  /*
    オリジナル役は「在籍メンバーのみ版」と「卒業生も込みの版」を枚数ごとに
    1つずつ登録できます。poolTypeが"active"の場合は在籍メンバーのみで
    構成されているかを追加で検証します。
  */
  function isValidSlotsForPool(slots, poolType) {
    if (!isValidSlots(slots)) return false;
    if (poolType === "active") return validateSlotsAgainstPool(slots, ACTIVE_MEMBERS);
    return true;
  }

  /* 旧API(name配列のみ)との後方互換ラッパー */
  function isValidCustomNames(names) {
    return isValidSlots((names || []).map(n => ({ type: "name", value: n })));
  }

  function isValidCustomNamesForPool(names, poolType) {
    return isValidSlotsForPool((names || []).map(n => ({ type: "name", value: n })), poolType);
  }

  /*
    5枚のカードが指定スロットを満たすか判定します。name枠は必要枚数分の
    カードを先に確保し、残ったカードを属性ワイルドカード枠に1枚ずつ
    重複なく割り当てられるかをバックトラックで確認します。
  */
  function matchesCustomSlots(cards, slots) {
    const nameSlots = slots.filter(s => s.type === "name");
    const attrSlots = slots.filter(s => s.type !== "name");

    const nameRequired = {};
    for (const s of nameSlots) nameRequired[s.value] = (nameRequired[s.value] || 0) + 1;

    const usedIdx = new Set();
    for (const name of Object.keys(nameRequired)) {
      let need = nameRequired[name];
      for (let i = 0; i < cards.length && need > 0; i++) {
        if (usedIdx.has(i)) continue;
        if (cards[i].name === name) {
          usedIdx.add(i);
          need--;
        }
      }
      if (need > 0) return false;
    }

    if (attrSlots.length === 0) return true;

    const freeIndices = cards.map((c, i) => i).filter(i => !usedIdx.has(i));

    function attrMatches(card, slot) {
      return card[slot.type] === slot.value;
    }

    function backtrack(slotIdx, available) {
      if (slotIdx === attrSlots.length) return true;
      const slot = attrSlots[slotIdx];
      for (let k = 0; k < available.length; k++) {
        const idx = available[k];
        if (attrMatches(cards[idx], slot)) {
          const next = available.slice(0, k).concat(available.slice(k + 1));
          if (backtrack(slotIdx + 1, next)) return true;
        }
      }
      return false;
    }

    return backtrack(0, freeIndices);
  }

  function matchesCustomHand(cards, names) {
    return matchesCustomSlots(cards, (names || []).map(n => ({ type: "name", value: n })));
  }

  function handMatchesType(cards, handDef) {
    if (handDef.type === "high") return true;
    if (handDef.type === "custom") return matchesCustomSlots(cards, getHandSlots(handDef));

    const genCounts = countBy(cards, "gen");
    const genValues = Object.values(genCounts).sort((a, b) => b - a);

    if (handDef.type === "gen") {
      return genValues[0] === handDef.size;
    }

    if (handDef.type === "genTwoPair") {
      return genValues[0] === 2 && genValues[1] === 2;
    }

    return false;
  }

  /*
    厳密な組み合わせ計算による発生確率(モンテカルロ法は使用しない)。
    デッキは1メンバーにつきCOPIES_PER_MEMBER枚の物理カードがあるため、
    「期ごとの人数」「指名する人数」はすべて物理カード枚数に換算して計算します。
    pool未指定時は全メンバー(MEMBERS)を対象とします。
  */
  function calcHandProbability(handDef, pool) {
    pool = pool || MEMBERS;
    if (handDef.type === "high") return 1;
    if (handDef.type === "custom") return exactCustomProbability(handDef, pool);
    return exactGenProbability(handDef, pool);
  }

  function exactGenProbability(handDef, pool) {
    pool = pool || MEMBERS;
    const genSizes = Object.values(countBy(pool, "gen")).map(n => n * COPIES_PER_MEMBER);
    const total = pool.length * COPIES_PER_MEMBER;
    const totalCombos = comb(total, 5);
    if (totalCombos === 0) return 0;

    let favorable = 0;

    function matchesCondition(counts) {
      const sorted = counts.filter(c => c > 0).sort((a, b) => b - a);
      if (handDef.type === "gen") return sorted[0] === handDef.size;
      if (handDef.type === "genTwoPair") return sorted[0] === 2 && sorted[1] === 2;
      return false;
    }

    function enumerate(idx, remaining, counts) {
      if (idx === genSizes.length) {
        if (remaining === 0 && matchesCondition(counts)) {
          let ways = 1;
          for (let i = 0; i < genSizes.length; i++) {
            ways *= comb(genSizes[i], counts[i]);
          }
          favorable += ways;
        }
        return;
      }

      const maxC = Math.min(genSizes[idx], remaining);
      for (let c = 0; c <= maxC; c++) {
        counts.push(c);
        enumerate(idx + 1, remaining - c, counts);
        counts.pop();
      }
    }

    enumerate(0, 5, []);
    return favorable / totalCombos;
  }

  /*
    オリジナル役の発生確率(name枠 + 属性ワイルドカード枠の混在に対応)。

    考え方:
    1. 指名された各人(name枠)について、引いた枚数n(必要枚数〜4枚)を列挙する。
       必要枚数を超えた分(余り)は、その人の期/グループに該当する属性ワイルドカード枠
       にも使える(同じ人の別の物理カードなので当然そのgen/groupを持つため)。
    2. 指名者以外の「その他」カードについて、属性ワイルドカード枠が要求する
       値(例: 2期, グループR)ごとの人数構成を列挙する。
    3. 1の余りと2の合計が、各ワイルドカード値の必要数を満たすかを確認する。
    gen枠とgroup枠は同じ役の中で混在しない(validateSlotsAgainstPoolで保証済み)ため、
    属性の種類は最大1つだけ扱えばよい。
  */
  function exactCustomProbability(handDef, pool) {
    pool = pool || MEMBERS;
    const slots = getHandSlots(handDef);
    if (!validateSlotsAgainstPool(slots, pool)) return 0;

    const total = pool.length * COPIES_PER_MEMBER;
    const totalCombos = comb(total, 5);
    if (totalCombos === 0) return 0;

    const nameSlots = slots.filter(s => s.type === "name");
    const attrSlots = slots.filter(s => s.type !== "name");
    const attrType = attrSlots.length ? attrSlots[0].type : null;

    const nameRequired = {};
    for (const s of nameSlots) nameRequired[s.value] = (nameRequired[s.value] || 0) + 1;
    const namedList = Object.keys(nameRequired);

    const wildcardRequired = {};
    for (const s of attrSlots) wildcardRequired[s.value] = (wildcardRequired[s.value] || 0) + 1;

    const otherMembers = pool.filter(p => !namedList.includes(p.name));
    const otherGroupSizes = {};
    if (attrType) {
      for (const p of otherMembers) {
        const v = p[attrType];
        otherGroupSizes[v] = (otherGroupSizes[v] || 0) + 1;
      }
    }
    const otherAttrKeys = Object.keys(otherGroupSizes);
    const otherTotal = otherMembers.length * COPIES_PER_MEMBER;

    const namedAttrValue = {};
    if (attrType) {
      for (const n of namedList) {
        const member = pool.find(p => p.name === n);
        namedAttrValue[n] = member ? member[attrType] : null;
      }
    }

    let favorable = 0;

    function resolveOther(remaining, surplusByAttr, ways) {
      if (remaining < 0) return;

      if (!attrType) {
        if (remaining <= otherTotal) favorable += ways * comb(otherTotal, remaining);
        return;
      }

      function enumerateOther(idx, rem, w, drawnByAttr) {
        if (idx === otherAttrKeys.length) {
          if (rem !== 0) return;
          const ok = Object.keys(wildcardRequired).every(v => {
            const have = (surplusByAttr[v] || 0) + (drawnByAttr[v] || 0);
            return have >= wildcardRequired[v];
          });
          if (ok) favorable += w;
          return;
        }

        const v = otherAttrKeys[idx];
        const capacity = otherGroupSizes[v] * COPIES_PER_MEMBER;
        const maxDraw = Math.min(capacity, rem);
        for (let d = 0; d <= maxDraw; d++) {
          enumerateOther(idx + 1, rem - d, w * comb(capacity, d), { ...drawnByAttr, [v]: d });
        }
      }

      enumerateOther(0, remaining, ways, {});
    }

    function recurseNamed(idx, surplusByAttr, drawnFromNamed, ways) {
      if (idx === namedList.length) {
        resolveOther(5 - drawnFromNamed, surplusByAttr, ways);
        return;
      }

      const name = namedList[idx];
      const need = nameRequired[name];
      for (let n = need; n <= COPIES_PER_MEMBER; n++) {
        const surplus = n - need;
        const nextSurplus = { ...surplusByAttr };
        if (attrType) {
          const v = namedAttrValue[name];
          nextSurplus[v] = (nextSurplus[v] || 0) + surplus;
        }
        recurseNamed(idx + 1, nextSurplus, drawnFromNamed + n, ways * comb(COPIES_PER_MEMBER, n));
      }
    }

    recurseNamed(0, {}, 0, 1);

    return favorable / totalCombos;
  }

  /*
    同期系の役(BASE_HANDS)は「同期ペア＜ダブル同期ペア＜同期3枚＜同期4枚＜同期5枚」という
    基本仕様で決められた順序を常に保ちます(期生ごとの人数が偏っているため、発生確率だけで
    並べ替えると同期3枚が同期ペアより強くなるなど直感に反する逆転が起きるため、固定順とします)。

    オリジナル役(customHands)は実際の発生確率を計算し、その値を使って同期系の役の
    並びの「隙間」に挿入します。隙間は同期系の役を弱い順に1つずつ確認し、まだ挿入していない
    オリジナル役のうち、その役より発生しやすい(確率が高い=弱い)ものを直前にまとめて挿入する
    ことで決定します。同期系の役同士の順序自体は絶対に入れ替えません。

    customHands: [{id,label,names}, ...]  (idで重複除去)
  */
  function buildHandDefs(customHands, pool) {
    pool = pool || MEMBERS;
    const seen = new Set();
    let customPool = (customHands || [])
      .filter(h => h && isValidSlots(getHandSlots(h)) && !seen.has(h.id) && seen.add(h.id))
      .map(h => {
        const slots = getHandSlots(h);
        return {
          id: h.id,
          label: h.label || `オリジナル役(${slots.map(describeSlot).join("・")})`,
          type: "custom",
          slots,
          probability: calcHandProbability({ type: "custom", slots }, pool)
        };
      });

    const fixedBase = BASE_HANDS
      .filter(h => h.type !== "high")
      .map(h => ({ ...h, probability: calcHandProbability(h, pool) }));

    const merged = [];

    for (const base of fixedBase) {
      const weakerCustoms = customPool.filter(c => c.probability > base.probability);
      customPool = customPool.filter(c => c.probability <= base.probability);
      weakerCustoms.sort((a, b) => b.probability - a.probability);
      merged.push(...weakerCustoms, base);
    }

    customPool.sort((a, b) => b.probability - a.probability);
    merged.push(...customPool);

    const HAND_DEFS = [{ id: "high", label: "ハイカード", type: "high", probability: 1 }, ...merged];
    const HAND_NAMES = HAND_DEFS.map(h => h.label);

    return { HAND_DEFS, HAND_NAMES };
  }

  function combinations(array, size) {
    const result = [];

    function helper(start, combo) {
      if (combo.length === size) {
        result.push(combo.slice());
        return;
      }
      for (let i = start; i < array.length; i++) {
        combo.push(array[i]);
        helper(i + 1, combo);
        combo.pop();
      }
    }

    helper(0, []);
    return result;
  }

  function evaluateFiveCards(cards, HAND_DEFS, HAND_NAMES) {
    const groupCounts = countBy(cards, "group");
    const groupValues = Object.values(groupCounts).sort((a, b) => b - a);

    let rank = 0;
    for (let i = HAND_DEFS.length - 1; i >= 0; i--) {
      const def = HAND_DEFS[i];
      if (def.type === "high") continue;
      if (handMatchesType(cards, def)) {
        rank = i;
        break;
      }
    }

    const genBonus = cards.reduce((sum, card) => sum + card.gen, 0);
    const groupBonus = groupValues[0] || 0;
    const score = rank * 100000 + genBonus * 10 + groupBonus;

    return {
      rank,
      score,
      name: HAND_NAMES[rank],
      detail: cards.map(card => `${card.name}(${card.gen}期)`).join(" / "),
      cards
    };
  }

  function evaluateBestHand(cards, HAND_DEFS, HAND_NAMES) {
    const fiveCardCombos = combinations(cards, 5);
    let best = { rank: 0, score: -1, name: "ハイカード", detail: "", cards: [] };

    for (const combo of fiveCardCombos) {
      const result = evaluateFiveCards(combo, HAND_DEFS, HAND_NAMES);
      if (result.score > best.score) best = result;
    }

    return best;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /*
    現在のターン以降(まだ場に出ていない残りカード)を踏まえて、各役を
    最終的に完成させられる確率を厳密に計算します。
    - すでに確定した役は1、絶対に完成しない役は0を返します。
    - 同期系の役は「その役のサイズ以上に到達できるか」(以上判定)で算出します。
    - オリジナル役は、まだ場に出ていない指名メンバーが残り枚数の中で
      引き切れる確率を包除原理で算出します。
    holeCards/communityCards: このプレイヤーから見えているカードのみを渡してください
    (他家の手札は不明情報として扱い、計算には含めません)。
  */
  function calcLiveHandProbabilities(holeCards, communityCards, pool, HAND_DEFS) {
    pool = pool || MEMBERS;
    const known = [...holeCards, ...communityCards];
    const drawsRemaining = Math.max(0, 5 - communityCards.length);

    const knownCountByName = countBy(known, "name");
    const remainingByName = {};
    for (const m of pool) {
      remainingByName[m.name] = COPIES_PER_MEMBER - (knownCountByName[m.name] || 0);
    }

    const genGroups = {};
    for (const m of pool) {
      genGroups[m.gen] = (genGroups[m.gen] || 0) + Math.max(0, remainingByName[m.name]);
    }

    const remainingPoolSize = Object.values(remainingByName).reduce((sum, n) => sum + Math.max(0, n), 0);
    const currentGenCounts = countBy(known, "gen");

    function matchesAtLeast(combinedCounts, handDef) {
      const sorted = combinedCounts.filter(c => c > 0).sort((a, b) => b - a);
      if (handDef.type === "gen") return sorted[0] >= handDef.size;
      if (handDef.type === "genTwoPair") return sorted.filter(c => c >= 2).length >= 2;
      return false;
    }

    function liveGenProbability(handDef) {
      const genKeys = Object.keys(genGroups);

      if (drawsRemaining === 0) {
        const combined = genKeys.map(g => currentGenCounts[g] || 0);
        return matchesAtLeast(combined, handDef) ? 1 : 0;
      }

      const totalCombos = comb(remainingPoolSize, drawsRemaining);
      if (totalCombos === 0) return 0;

      let favorable = 0;

      function enumerate(idx, remaining, added) {
        if (idx === genKeys.length) {
          if (remaining === 0) {
            const combined = genKeys.map((g, i) => (currentGenCounts[g] || 0) + added[i]);
            if (matchesAtLeast(combined, handDef)) {
              let ways = 1;
              for (let i = 0; i < genKeys.length; i++) ways *= comb(genGroups[genKeys[i]], added[i]);
              favorable += ways;
            }
          }
          return;
        }

        const maxAdd = Math.min(genGroups[genKeys[idx]], remaining);
        for (let c = 0; c <= maxAdd; c++) {
          added.push(c);
          enumerate(idx + 1, remaining - c, added);
          added.pop();
        }
      }

      enumerate(0, drawsRemaining, []);
      return favorable / totalCombos;
    }

    function liveCustomProbability(handDef) {
      const slots = getHandSlots(handDef);
      const nameSlots = slots.filter(s => s.type === "name");
      const attrSlots = slots.filter(s => s.type !== "name");
      const attrType = attrSlots.length ? attrSlots[0].type : null;

      const nameRequired = {};
      for (const s of nameSlots) nameRequired[s.value] = (nameRequired[s.value] || 0) + 1;
      const namedList = Object.keys(nameRequired);

      const wildcardRequired = {};
      for (const s of attrSlots) wildcardRequired[s.value] = (wildcardRequired[s.value] || 0) + 1;

      if (!namedList.every(n => remainingByName[n] !== undefined)) return 0;

      const totalCombos = comb(remainingPoolSize, drawsRemaining);
      if (totalCombos === 0) return 0;

      // 既知カードのうち「指名者以外」のものを属性値ごとに数える(確定済みの寄与分)
      const knownOtherByAttr = {};
      if (attrType) {
        for (const c of known) {
          if (namedList.includes(c.name)) continue;
          const v = c[attrType];
          knownOtherByAttr[v] = (knownOtherByAttr[v] || 0) + 1;
        }
      }

      // 指名者以外の「残り」を属性値ごとに集計(既知分はremainingByNameで反映済み)
      const otherRemainingByAttr = {};
      if (attrType) {
        for (const m of pool) {
          if (namedList.includes(m.name)) continue;
          const v = m[attrType];
          otherRemainingByAttr[v] = (otherRemainingByAttr[v] || 0) + Math.max(0, remainingByName[m.name]);
        }
      }
      const otherAttrKeys = Object.keys(otherRemainingByAttr);
      const otherRemainingNoAttr = remainingPoolSize - namedList.reduce((s, n) => s + remainingByName[n], 0);

      let favorable = 0;

      function resolveOther(remaining, surplusByAttr, ways) {
        if (remaining < 0) return;

        if (!attrType) {
          if (remaining <= otherRemainingNoAttr) favorable += ways * comb(otherRemainingNoAttr, remaining);
          return;
        }

        function enumerateOther(idx, rem, w, drawnByAttr) {
          if (idx === otherAttrKeys.length) {
            if (rem !== 0) return;
            const ok = Object.keys(wildcardRequired).every(v => {
              const have = (knownOtherByAttr[v] || 0) + (surplusByAttr[v] || 0) + (drawnByAttr[v] || 0);
              return have >= wildcardRequired[v];
            });
            if (ok) favorable += w;
            return;
          }

          const v = otherAttrKeys[idx];
          const capacity = otherRemainingByAttr[v];
          const maxDraw = Math.min(capacity, rem);
          for (let d = 0; d <= maxDraw; d++) {
            enumerateOther(idx + 1, rem - d, w * comb(capacity, d), { ...drawnByAttr, [v]: d });
          }
        }

        enumerateOther(0, remaining, ways, {});
      }

      function recurseNamed(idx, surplusByAttr, futureDrawnFromNamed, ways) {
        if (idx === namedList.length) {
          resolveOther(drawsRemaining - futureDrawnFromNamed, surplusByAttr, ways);
          return;
        }

        const name = namedList[idx];
        const totalSeen = knownCountByName[name] || 0;
        const need = Math.max(0, nameRequired[name] - totalSeen);
        const cap = remainingByName[name];

        for (let c = need; c <= cap; c++) {
          const totalAfter = totalSeen + c;
          const surplus = Math.max(0, totalAfter - nameRequired[name]);
          const nextSurplus = { ...surplusByAttr };
          if (attrType) {
            const v = pool.find(p => p.name === name)[attrType];
            nextSurplus[v] = (nextSurplus[v] || 0) + surplus;
          }
          recurseNamed(idx + 1, nextSurplus, futureDrawnFromNamed + c, ways * comb(cap, c));
        }
      }

      recurseNamed(0, {}, 0, 1);

      return favorable / totalCombos;
    }

    return HAND_DEFS
      .filter(h => h.type !== "high")
      .map(h => ({
        id: h.id,
        label: h.label,
        liveProbability: h.type === "custom" ? liveCustomProbability(h) : liveGenProbability(h)
      }));
  }

  /* =========================================================
     卓(テーブル)エンジン
     CPU対戦(ブラウザのみ)とオンライン対戦(サーバー)の両方から
     同じベッティング/フェーズ進行ロジックを使うための共通実装です。
     ボット操作やネットワーク送受信は呼び出し側のコールバックに委譲します。
  ========================================================= */
  function createTable(options) {
    options = options || {};
    const names = options.playerNames || [];
    const customHandsPool = options.customHandsPool || [];
    const smallBlind = options.smallBlind || 10;
    const bigBlind = options.bigBlind || 20;
    const startingChips = options.startingChips || 1000;
    const onChange = options.onChange || function () {};
    const isBot = options.isBot || function () { return false; };
    const onBotTurn = options.onBotTurn || function () {};
    const isConnected = options.isConnected || function () { return true; };
    const isDisposed = options.isDisposed || function () { return false; };
    const autoAdvanceMs = options.autoAdvanceMs || null;
    const deckPool = options.deckPool || ACTIVE_MEMBERS;

    const built = buildHandDefs(customHandsPool, deckPool);

    const table = {
      players: names.map(name => ({
        name,
        chips: startingChips,
        holeCards: [],
        folded: false,
        sittingOut: false,
        allIn: false,
        betThisRound: 0,
        totalBetThisHand: 0
      })),
      dealerIndex: -1,
      phaseIndex: 0,
      handPhase: "waiting",
      communityCards: [],
      deck: [],
      pot: 0,
      currentBetLevel: 0,
      pendingActors: [],
      turnSeat: null,
      handCount: 0,
      message: "",
      gameOver: false,
      lastResult: null,
      deckPool,
      HAND_DEFS: built.HAND_DEFS,
      HAND_NAMES: built.HAND_NAMES
    };

    function seatsInOrderFrom(startSeat, predicate) {
      const n = table.players.length;
      const result = [];
      for (let step = 1; step <= n; step++) {
        const idx = (startSeat + step) % n;
        if (predicate(table.players[idx])) result.push(idx);
      }
      return result;
    }

    function nextSeat(fromIndex, predicate) {
      const n = table.players.length;
      for (let step = 1; step <= n; step++) {
        const idx = (((fromIndex + step) % n) + n) % n;
        if (predicate(table.players[idx])) return idx;
      }
      return fromIndex < 0 ? 0 : fromIndex;
    }

    function commitBet(p, amount) {
      const paid = Math.min(Math.max(0, Math.floor(amount) || 0), p.chips);
      p.chips -= paid;
      p.betThisRound += paid;
      p.totalBetThisHand += paid;
      table.pot += paid;
      if (p.chips === 0) p.allIn = true;
      return paid;
    }

    function drawCard() {
      return table.deck.pop();
    }

    function notifyChange() {
      onChange(table);
    }

    function scheduleNext() {
      if (autoAdvanceMs == null) return;
      setTimeout(() => {
        if (table.gameOver || isDisposed()) return;
        startHand();
      }, autoAdvanceMs);
    }

    function awardUncontested(seat) {
      const winner = table.players[seat];
      winner.chips += table.pot;
      table.message = `${winner.name} の勝利！(他の全員がフォールド) 獲得ポット：${table.pot}pt`;
      table.pot = 0;
      table.handPhase = "result";
      table.lastResult = {
        winners: [{ seat, name: winner.name, handName: null }],
        uncontested: true
      };
      notifyChange();
      scheduleNext();
    }

    function showdownAndAward() {
      const contenders = table.players
        .map((p, i) => ({ i, p }))
        .filter(({ p }) => !p.sittingOut && !p.folded);

      const evals = contenders.map(({ i, p }) => ({
        i,
        name: p.name,
        evalResult: evaluateBestHand([...p.holeCards, ...table.communityCards], table.HAND_DEFS, table.HAND_NAMES)
      }));

      const maxScore = Math.max(...evals.map(e => e.evalResult.score));
      const winners = evals.filter(e => e.evalResult.score === maxScore);
      const share = Math.floor(table.pot / winners.length);
      const remainder = table.pot - share * winners.length;

      winners.forEach((w, idx) => {
        table.players[w.i].chips += share + (idx < remainder ? 1 : 0);
      });

      const summary = evals.map(e => `${e.name}:「${e.evalResult.name}」(${e.evalResult.detail})`).join("<br>");
      const winnerNames = winners.map(w => w.name).join("・");

      table.message = winners.length > 1
        ? `引き分け！(${winnerNames})がポットを分け合いました。<br>${summary}`
        : `${winnerNames} の勝利！「${winners[0].evalResult.name}」<br>${summary}`;

      table.pot = 0;
      table.handPhase = "result";
      table.lastResult = {
        winners: winners.map(w => ({
          seat: w.i,
          name: w.name,
          handName: w.evalResult.name,
          cards: w.evalResult.cards,
          detail: w.evalResult.detail
        })),
        uncontested: false
      };
      notifyChange();
      scheduleNext();
    }

    function nextPhase() {
      table.players.forEach(p => { p.betThisRound = 0; });
      table.currentBetLevel = 0;
      table.phaseIndex = (table.phaseIndex || 0) + 1;

      if (table.phaseIndex === 1) {
        table.communityCards.push(drawCard(), drawCard(), drawCard());
        table.message = "フロップ公開！";
      } else if (table.phaseIndex === 2) {
        table.communityCards.push(drawCard());
        table.message = "ターン公開！";
      } else if (table.phaseIndex === 3) {
        table.communityCards.push(drawCard());
        table.message = "リバー公開！";
      } else {
        showdownAndAward();
        return;
      }

      const contenders = table.players.filter(p => !p.sittingOut && !p.folded);
      const ableToAct = contenders.filter(p => !p.allIn && p.chips > 0).length;

      if (ableToAct <= 1) {
        notifyChange();
        setTimeout(() => nextPhase(), 900);
        return;
      }

      table.pendingActors = seatsInOrderFrom(table.dealerIndex, p => !p.sittingOut && !p.folded && !p.allIn && p.chips > 0);
      promptNext();
    }

    function promptNext() {
      while (table.pendingActors.length > 0) {
        const seat = table.pendingActors[0];

        if (!isConnected(seat)) {
          table.pendingActors.shift();
          table.players[seat].folded = true;
          const remaining = table.players.filter(p => !p.sittingOut && !p.folded);
          if (remaining.length === 1) {
            awardUncontested(table.players.indexOf(remaining[0]));
            return;
          }
          continue;
        }

        table.turnSeat = seat;
        notifyChange();
        if (isBot(seat)) onBotTurn(seat);
        return;
      }

      nextPhase();
    }

    function afterAction() {
      const remaining = table.players.filter(p => !p.sittingOut && !p.folded);
      if (remaining.length === 1) {
        awardUncontested(table.players.indexOf(remaining[0]));
        return;
      }
      if (table.pendingActors.length === 0) {
        nextPhase();
        return;
      }
      promptNext();
    }

    function action(seat, type, amount) {
      if (table.handPhase !== "betting") return;
      if (table.turnSeat !== seat) return;

      const p = table.players[seat];
      const callAmount = Math.max(0, table.currentBetLevel - p.betThisRound);

      if (type === "fold") {
        table.pendingActors.shift();
        p.folded = true;
        table.message = `${p.name} がフォールドしました。`;
        afterAction();
        return;
      }

      if (type === "check") {
        table.pendingActors.shift();
        if (callAmount > 0) {
          const paid = commitBet(p, callAmount);
          table.message = `${p.name} が ${paid}pt をコールしました。`;
        } else {
          table.message = `${p.name} がチェックしました。`;
        }
        afterAction();
        return;
      }

      if (type === "bet") {
        if (table.currentBetLevel > 0) return;
        table.pendingActors.shift();
        const amt = Math.min(p.chips, Math.max(10, Math.floor(Number(amount) || 0)));
        const paid = commitBet(p, amt);
        table.currentBetLevel = p.betThisRound;
        table.message = `${p.name} が ${paid}pt をベットしました。`;
        table.pendingActors = seatsInOrderFrom(seat, x => !x.sittingOut && !x.folded && !x.allIn && x.chips > 0 && x !== p);
        afterAction();
        return;
      }

      if (type === "raise") {
        if (table.currentBetLevel <= 0) return;
        table.pendingActors.shift();
        const extra = Math.max(10, Math.floor(Number(amount) || 0));
        const paid = commitBet(p, callAmount + extra);
        table.currentBetLevel = p.betThisRound;
        table.message = `${p.name} が ${p.betThisRound}pt にレイズしました。(${paid}pt支払い)`;
        table.pendingActors = seatsInOrderFrom(seat, x => !x.sittingOut && !x.folded && !x.allIn && x.chips > 0 && x !== p);
        afterAction();
        return;
      }
    }

    function startHand() {
      table.players.forEach(p => { p.sittingOut = p.chips <= 0; });
      const activeCount = table.players.filter(p => !p.sittingOut).length;

      if (activeCount <= 1) {
        table.handPhase = "gameover";
        table.gameOver = true;
        const winner = table.players.find(p => !p.sittingOut);
        table.message = winner ? `${winner.name} が優勝しました！` : "ゲーム終了。";
        notifyChange();
        return;
      }

      table.players.forEach(p => {
        p.holeCards = [];
        p.folded = p.sittingOut;
        p.allIn = false;
        p.betThisRound = 0;
        p.totalBetThisHand = 0;
      });

      table.communityCards = [];
      table.pot = 0;
      table.currentBetLevel = 0;
      table.phaseIndex = 0;
      table.handCount += 1;
      table.lastResult = null;
      table.dealerIndex = nextSeat(table.dealerIndex, p => !p.sittingOut);
      table.deck = shuffle(buildDeck(deckPool));

      table.players.forEach(p => {
        if (!p.sittingOut) p.holeCards = [drawCard(), drawCard()];
      });

      const activeOrder = seatsInOrderFrom(table.dealerIndex, p => !p.sittingOut);
      const sbSeat = activeOrder[0];
      const bbSeat = activeOrder.length > 1 ? activeOrder[1] : activeOrder[0];

      commitBet(table.players[sbSeat], smallBlind);
      commitBet(table.players[bbSeat], bigBlind);
      table.currentBetLevel = table.players[bbSeat].betThisRound;

      table.handPhase = "betting";
      table.message = `第${table.handCount}ハンド開始。${table.players[sbSeat].name}がSB(${smallBlind}pt)、${table.players[bbSeat].name}がBB(${bigBlind}pt)を払いました。`;

      table.pendingActors = seatsInOrderFrom(bbSeat, p => !p.sittingOut && !p.folded && !p.allIn && p.chips > 0);
      promptNext();
    }

    table.action = action;
    table.startGame = function () {
      table.dealerIndex = -1;
      table.gameOver = false;
      table.handCount = 0;
      startHand();
    };
    table.callAmountFor = function (seat) {
      const p = table.players[seat];
      return Math.max(0, table.currentBetLevel - p.betThisRound);
    };

    return table;
  }

  return {
    MEMBERS,
    ACTIVE_MEMBERS,
    GRADUATED_MEMBERS,
    DECKS,
    COPIES_PER_MEMBER,
    buildDeck,
    sortMembers,
    BASE_HANDS,
    MIN_CUSTOM_SIZE,
    MAX_CUSTOM_SIZE,
    countBy,
    comb,
    isValidCustomNames,
    isValidCustomNamesForPool,
    matchesCustomHand,
    getHandSlots,
    describeSlot,
    isValidSlots,
    isValidSlotsForPool,
    matchesCustomSlots,
    handMatchesType,
    calcHandProbability,
    buildHandDefs,
    calcLiveHandProbabilities,
    combinations,
    evaluateFiveCards,
    evaluateBestHand,
    shuffle,
    createTable
  };
});
