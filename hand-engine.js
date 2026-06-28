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

  const MEMBERS = [
    { name: "上村莉菜", gen: 1, initial: "う", group: "R" },
    { name: "小池美波", gen: 1, initial: "こ", group: "M" },
    { name: "齋藤冬優花", gen: 1, initial: "さ", group: "F" },

    { name: "井上梨名", gen: 2, initial: "い", group: "R" },
    { name: "遠藤光莉", gen: 2, initial: "え", group: "H" },
    { name: "大園玲", gen: 2, initial: "お", group: "R" },
    { name: "大沼晶保", gen: 2, initial: "お", group: "A" },
    { name: "幸阪茉里乃", gen: 2, initial: "こ", group: "M" },
    { name: "武元唯衣", gen: 2, initial: "た", group: "Y" },
    { name: "田村保乃", gen: 2, initial: "た", group: "H" },
    { name: "藤吉夏鈴", gen: 2, initial: "ふ", group: "K" },
    { name: "増本綺良", gen: 2, initial: "ま", group: "K" },
    { name: "松田里奈", gen: 2, initial: "ま", group: "R" },
    { name: "森田ひかる", gen: 2, initial: "も", group: "H" },
    { name: "守屋麗奈", gen: 2, initial: "も", group: "R" },
    { name: "山﨑天", gen: 2, initial: "や", group: "T" },

    { name: "石森璃花", gen: 3, initial: "い", group: "R" },
    { name: "遠藤理子", gen: 3, initial: "え", group: "R" },
    { name: "小田倉麗奈", gen: 3, initial: "お", group: "R" },
    { name: "小島凪紗", gen: 3, initial: "こ", group: "N" },
    { name: "谷口愛季", gen: 3, initial: "た", group: "A" },
    { name: "中嶋優月", gen: 3, initial: "な", group: "Y" },
    { name: "的野美青", gen: 3, initial: "ま", group: "M" },
    { name: "向井純葉", gen: 3, initial: "む", group: "I" },
    { name: "村井優", gen: 3, initial: "む", group: "Y" },
    { name: "村山美羽", gen: 3, initial: "む", group: "M" },
    { name: "山下瞳月", gen: 3, initial: "や", group: "S" },

    { name: "櫻エース", gen: 4, initial: "さ", group: "S" },
    { name: "櫻ルーキー", gen: 4, initial: "る", group: "S" },
    { name: "櫻スター", gen: 4, initial: "す", group: "S" },
    { name: "櫻ドリーム", gen: 4, initial: "ど", group: "S" }
  ];

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

  function isValidCustomNames(names) {
    return (
      Array.isArray(names) &&
      names.length >= MIN_CUSTOM_SIZE &&
      names.length <= MAX_CUSTOM_SIZE &&
      new Set(names).size === names.length &&
      names.every(n => MEMBERS.some(m => m.name === n))
    );
  }

  function matchesCustomHand(cards, names) {
    const cardNames = cards.map(c => c.name);
    return names.every(n => cardNames.includes(n));
  }

  function handMatchesType(cards, handDef) {
    if (handDef.type === "high") return true;
    if (handDef.type === "custom") return matchesCustomHand(cards, handDef.names);

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

  /* 厳密な組み合わせ計算による発生確率(モンテカルロ法は使用しない) */
  function calcHandProbability(handDef) {
    if (handDef.type === "high") return 1;
    if (handDef.type === "custom") return exactCustomProbability(handDef);
    return exactGenProbability(handDef);
  }

  function exactGenProbability(handDef) {
    const genSizes = Object.values(countBy(MEMBERS, "gen"));
    const total = MEMBERS.length;
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

  function exactCustomProbability(handDef) {
    const total = MEMBERS.length;
    const m = handDef.names.length;
    if (!isValidCustomNames(handDef.names)) return 0;

    const totalCombos = comb(total, 5);
    if (totalCombos === 0) return 0;

    const favorable = comb(total - m, 5 - m);
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
  function buildHandDefs(customHands) {
    const seen = new Set();
    let customPool = (customHands || [])
      .filter(h => h && isValidCustomNames(h.names) && !seen.has(h.id) && seen.add(h.id))
      .map(h => ({
        id: h.id,
        label: h.label || `オリジナル役(${h.names.join("・")})`,
        type: "custom",
        names: h.names,
        probability: calcHandProbability({ type: "custom", names: h.names })
      }));

    const fixedBase = BASE_HANDS
      .filter(h => h.type !== "high")
      .map(h => ({ ...h, probability: calcHandProbability(h) }));

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
        result.push(combo);
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
      detail: cards.map(card => `${card.name}(${card.gen}期)`).join(" / ")
    };
  }

  function evaluateBestHand(cards, HAND_DEFS, HAND_NAMES) {
    const fiveCardCombos = combinations(cards, 5);
    let best = { rank: 0, score: -1, name: "ハイカード", detail: "" };

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

    const built = buildHandDefs(customHandsPool);

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

      const summary = evals.map(e => `${e.name}:「${e.evalResult.name}」`).join(" / ");
      const winnerNames = winners.map(w => w.name).join("・");

      table.message = winners.length > 1
        ? `引き分け！(${winnerNames})がポットを分け合いました。<br>${summary}`
        : `${winnerNames} の勝利！「${winners[0].evalResult.name}」<br>${summary}`;

      table.pot = 0;
      table.handPhase = "result";
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
      table.dealerIndex = nextSeat(table.dealerIndex, p => !p.sittingOut);
      table.deck = shuffle(MEMBERS.slice());

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
    BASE_HANDS,
    MIN_CUSTOM_SIZE,
    MAX_CUSTOM_SIZE,
    countBy,
    comb,
    isValidCustomNames,
    matchesCustomHand,
    handMatchesType,
    calcHandProbability,
    buildHandDefs,
    combinations,
    evaluateFiveCards,
    evaluateBestHand,
    shuffle,
    createTable
  };
});
