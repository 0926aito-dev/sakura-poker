/**
 * CPUオリジナル役の設定ファイル (cpu_hands.xlsx) を生成するスクリプト。
 * 使い方: node tools/generate-cpu-hands-xlsx.js
 *
 * 生成された cpu_hands.xlsx を Excel で編集し、サーバー起動時に自動で読み込まれます。
 */
const XLSX = require("xlsx");
const path = require("path");

// --- 列定義 ---
// CPU番号, 役名, poolType, スロット1〜5の(種別, 値)
const headers = [
  "CPU番号",
  "役名",
  "デッキ種別(active/all)",
  "スロット1種別",
  "スロット1値",
  "スロット2種別",
  "スロット2値",
  "スロット3種別",
  "スロット3値",
  "スロット4種別",
  "スロット4値",
  "スロット5種別",
  "スロット5値",
];

// スロット種別の選択肢メモ(コメント行)
const noteRow = [
  "※1〜3",
  "自由に設定",
  "active または all",
  "name / wild / gen / group",
  "メンバー名 / 期番号 / ユニット名 / (wildは空白)",
  "↑同上",
  "↑同上",
  "↑同上",
  "↑同上",
  "↑同上",
  "↑同上",
  "↑同上",
  "↑同上",
];

// サンプルデータ (実際のメンバー名は members.json から取得可能)
const sampleRows = [
  // CPU 1
  [1, "山崎天(2枚)", "active", "name", "山崎天", "wild", "", "", "", "", "", "", ""],
  [1, "山崎天(3枚)", "active", "name", "山崎天", "wild", "", "wild", "", "", "", "", ""],
  [1, "山崎天(4枚)", "active", "name", "山崎天", "wild", "", "wild", "", "wild", "", "", ""],
  [1, "山崎天(5枚)", "active", "name", "山崎天", "wild", "", "wild", "", "wild", "", "wild", ""],
  // CPU 2
  [2, "藤吉夏鈴(2枚)", "active", "name", "藤吉夏鈴", "wild", "", "", "", "", "", "", ""],
  [2, "藤吉夏鈴(3枚)", "active", "name", "藤吉夏鈴", "wild", "", "wild", "", "", "", "", ""],
  [2, "藤吉夏鈴(4枚)", "active", "name", "藤吉夏鈴", "wild", "", "wild", "", "wild", "", "", ""],
  [2, "藤吉夏鈴(5枚)", "active", "name", "藤吉夏鈴", "wild", "", "wild", "", "wild", "", "wild", ""],
  // CPU 3
  [3, "遠藤理子(2枚)", "active", "name", "遠藤理子", "wild", "", "", "", "", "", "", ""],
  [3, "遠藤理子(3枚)", "active", "name", "遠藤理子", "wild", "", "wild", "", "", "", "", ""],
  [3, "遠藤理子(4枚)", "active", "name", "遠藤理子", "wild", "", "wild", "", "wild", "", "", ""],
  [3, "遠藤理子(5枚)", "active", "name", "遠藤理子", "wild", "", "wild", "", "wild", "", "wild", ""],
];

const wb = XLSX.utils.book_new();
const wsData = [headers, noteRow, ...sampleRows];
const ws = XLSX.utils.aoa_to_sheet(wsData);

// 列幅を設定
ws["!cols"] = [
  { wch: 8 },  // CPU番号
  { wch: 20 }, // 役名
  { wch: 18 }, // デッキ種別
  { wch: 16 }, // スロット1種別
  { wch: 14 }, // スロット1値
  { wch: 16 }, { wch: 14 },
  { wch: 16 }, { wch: 14 },
  { wch: 16 }, { wch: 14 },
  { wch: 16 }, { wch: 14 },
];

// ヘッダー行を太字にするためのスタイル (xlsx パッケージ標準では限定的)
XLSX.utils.book_append_sheet(wb, ws, "CPUオリジナル役");

// 説明シートを追加
const infoData = [
  ["CPUオリジナル役 設定ファイル"],
  [""],
  ["【使い方】"],
  ["1. 「CPUオリジナル役」シートを編集する"],
  ["2. 1行目(ヘッダー)と2行目(メモ)は変更しない"],
  ["3. 3行目以降にCPUの役を記入する"],
  ["4. サーバーを再起動すると自動で読み込まれる"],
  [""],
  ["【スロット種別】"],
  ["name   … 特定のメンバー (値=メンバー名)"],
  ["wild   … 任意のメンバー (値は空白でよい)"],
  ["gen    … 特定の期 (値=期番号、例: 1)"],
  ["group  … 特定のユニット (値=ユニット名、例: BishopRing)"],
  [""],
  ["【デッキ種別】"],
  ["active … 在籍メンバーのみのデッキ"],
  ["all    … 卒業メンバーを含む全メンバーデッキ"],
  [""],
  ["【注意】"],
  ["CPU番号は 1〜3 の整数を入力してください"],
  ["各CPUに設定された役の分だけデッキのカード枚数も増えます"],
];
const wsInfo = XLSX.utils.aoa_to_sheet(infoData);
wsInfo["!cols"] = [{ wch: 50 }];
XLSX.utils.book_append_sheet(wb, wsInfo, "説明");

const outPath = path.join(__dirname, "..", "cpu_hands.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`✅ ${outPath} を生成しました`);
console.log("Excel で編集後、サーバーを再起動してください。");
