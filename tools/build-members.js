"use strict";

/*
  members.xlsx を読み込み、ゲーム側で使う members-data.js を生成します。
  メンバー情報(名前・期・頭文字・グループ・在籍状況)を変更したい場合は、
  members.xlsx をExcelで編集してから `npm run build-members` を実行してください。
*/

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const XLSX_PATH = path.join(__dirname, "..", "members.xlsx");
const OUT_PATH = path.join(__dirname, "..", "members-data.js");

if (!fs.existsSync(XLSX_PATH)) {
  console.error("members.xlsx が見つかりません。先に `node tools/seed-members-xlsx.js` を実行してください。");
  process.exit(1);
}

const workbook = XLSX.readFile(XLSX_PATH);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// 1行目は見出し(日本語ラベル)なので range:1 でスキップし、固定キーで読み込む
const rows = XLSX.utils.sheet_to_json(sheet, {
  header: ["name", "gen", "initial", "group", "status"],
  range: 1,
  defval: ""
});

const VALID_STATUS = new Set(["在籍", "卒業"]);
const errors = [];
const members = [];

rows.forEach((row, i) => {
  const lineNo = i + 2; // Excel上の行番号(見出し行を含む)
  const name = String(row.name || "").trim();
  if (!name) return; // 空行はスキップ

  const gen = Number(row.gen);
  const initial = String(row.initial || "").trim();
  const group = String(row.group || "").trim();
  const status = String(row.status || "").trim();

  if (!Number.isInteger(gen) || gen <= 0) {
    errors.push(`${lineNo}行目「${name}」: 期(gen)は正の整数で入力してください。`);
  }
  if (!initial) {
    errors.push(`${lineNo}行目「${name}」: 頭文字(initial)が空です。`);
  }
  if (!group) {
    errors.push(`${lineNo}行目「${name}」: グループ(group)が空です。`);
  }
  if (!VALID_STATUS.has(status)) {
    errors.push(`${lineNo}行目「${name}」: 在籍状況(status)は「在籍」または「卒業」で入力してください(入力値: "${status}")。`);
  }

  members.push({
    name,
    gen,
    initial,
    group,
    status: status === "卒業" ? "graduated" : "active"
  });
});

const names = members.map(m => m.name);
const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
if (duplicates.length > 0) {
  errors.push(`名前が重複しています: ${[...new Set(duplicates)].join("・")}`);
}

if (errors.length > 0) {
  console.error("members.xlsx の内容にエラーがあります。修正してから再実行してください:");
  errors.forEach(e => console.error(" - " + e));
  process.exit(1);
}

const fileContent = `"use strict";

/* =========================================================
   members-data.js (自動生成ファイル)
   このファイルは tools/build-members.js によって members.xlsx から
   自動生成されます。直接編集しないでください。
   メンバー情報を変更する場合は members.xlsx を編集し、
   \`npm run build-members\` を再実行してください。
========================================================= */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  } else {
    root.SAKURA_MEMBERS_DATA = mod;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  return ${JSON.stringify(members, null, 2)};
});
`;

fs.writeFileSync(OUT_PATH, fileContent, "utf8");
console.log(`members-data.js を生成しました(${members.length}名 / 在籍:${members.filter(m => m.status === "active").length}名 / 卒業:${members.filter(m => m.status === "graduated").length}名)`);
