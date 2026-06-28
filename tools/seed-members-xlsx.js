"use strict";

/*
  members.xlsx の初回生成スクリプト。
  既存の固定メンバー配列(31名)に status列(在籍/卒業)を付けてExcel化します。
  既に members.xlsx が存在する場合は誤って上書きしないよう停止します。
  メンバー情報を編集したい場合は、このスクリプトではなく members.xlsx を
  直接Excelで開いて編集し、`npm run build-members` を実行してください。
*/

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const OUT_PATH = path.join(__dirname, "..", "members.xlsx");

if (fs.existsSync(OUT_PATH)) {
  console.log("members.xlsx は既に存在します。上書きしないため終了します。");
  process.exit(0);
}

const MEMBERS_SEED = [
  { name: "上村莉菜", gen: 1, initial: "う", group: "R", status: "在籍" },
  { name: "小池美波", gen: 1, initial: "こ", group: "M", status: "在籍" },
  { name: "齋藤冬優花", gen: 1, initial: "さ", group: "F", status: "在籍" },

  { name: "井上梨名", gen: 2, initial: "い", group: "R", status: "在籍" },
  { name: "遠藤光莉", gen: 2, initial: "え", group: "H", status: "在籍" },
  { name: "大園玲", gen: 2, initial: "お", group: "R", status: "在籍" },
  { name: "大沼晶保", gen: 2, initial: "お", group: "A", status: "在籍" },
  { name: "幸阪茉里乃", gen: 2, initial: "こ", group: "M", status: "在籍" },
  { name: "武元唯衣", gen: 2, initial: "た", group: "Y", status: "在籍" },
  { name: "田村保乃", gen: 2, initial: "た", group: "H", status: "在籍" },
  { name: "藤吉夏鈴", gen: 2, initial: "ふ", group: "K", status: "在籍" },
  { name: "増本綺良", gen: 2, initial: "ま", group: "K", status: "在籍" },
  { name: "松田里奈", gen: 2, initial: "ま", group: "R", status: "在籍" },
  { name: "森田ひかる", gen: 2, initial: "も", group: "H", status: "在籍" },
  { name: "守屋麗奈", gen: 2, initial: "も", group: "R", status: "在籍" },
  { name: "山﨑天", gen: 2, initial: "や", group: "T", status: "在籍" },

  { name: "石森璃花", gen: 3, initial: "い", group: "R", status: "在籍" },
  { name: "遠藤理子", gen: 3, initial: "え", group: "R", status: "在籍" },
  { name: "小田倉麗奈", gen: 3, initial: "お", group: "R", status: "在籍" },
  { name: "小島凪紗", gen: 3, initial: "こ", group: "N", status: "在籍" },
  { name: "谷口愛季", gen: 3, initial: "た", group: "A", status: "在籍" },
  { name: "中嶋優月", gen: 3, initial: "な", group: "Y", status: "在籍" },
  { name: "的野美青", gen: 3, initial: "ま", group: "M", status: "在籍" },
  { name: "向井純葉", gen: 3, initial: "む", group: "I", status: "在籍" },
  { name: "村井優", gen: 3, initial: "む", group: "Y", status: "在籍" },
  { name: "村山美羽", gen: 3, initial: "む", group: "M", status: "在籍" },
  { name: "山下瞳月", gen: 3, initial: "や", group: "S", status: "在籍" },

  { name: "櫻エース", gen: 4, initial: "さ", group: "S", status: "在籍" },
  { name: "櫻ルーキー", gen: 4, initial: "る", group: "S", status: "在籍" },
  { name: "櫻スター", gen: 4, initial: "す", group: "S", status: "在籍" },
  { name: "櫻ドリーム", gen: 4, initial: "ど", group: "S", status: "在籍" }
];

const sheet = XLSX.utils.json_to_sheet(MEMBERS_SEED, {
  header: ["name", "gen", "initial", "group", "status"]
});

// 列の日本語見出し行を先頭に追加し直す(json_to_sheetはプロパティ名そのものを見出しにするため)
XLSX.utils.sheet_add_aoa(sheet, [["名前(name)", "期(gen)", "頭文字(initial)", "グループ(group)", "在籍状況(status: 在籍/卒業)"]], { origin: "A1" });

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "members");
XLSX.writeFile(workbook, OUT_PATH);

console.log(`members.xlsx を作成しました(${MEMBERS_SEED.length}名)。`);
console.log("Excelで開いて編集後、`npm run build-members` を実行してください。");
