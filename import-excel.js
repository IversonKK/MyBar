const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const excelPath = path.join(__dirname, 'menu_database.xlsx');
const recipePath = path.join(__dirname, 'recipe.json');

if (!fs.existsSync(excelPath)) {
    console.log('找不到 menu_database.xlsx，請確認檔案存在！');
    process.exit(1);
}

const wb = xlsx.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(ws);

let recipeDatabase = {};

data.forEach(row => {
    const name = row["酒名 (必須與圖片同名)"];
    if (!name) return; // 略過空白行

    // 將 Excel 分欄重新組合成系統看的懂的格式
    let finalDesc = "";
    if (row["材料"]) finalDesc += `材料：${row["材料"]}\n`;
    if (row["技法"]) finalDesc += `技法：${row["技法"]}\n`;
    if (row["杯型"]) finalDesc += `杯型：${row["杯型"]}\n`;
    if (row["裝飾"]) finalDesc += `裝飾：${row["裝飾"]}\n`;
    if (row["故事與敘述"]) finalDesc += row["故事與敘述"];

    recipeDatabase[name] = {
        abv: parseFloat(row["濃度 (%)"]) || 15, strong: parseInt(row["酒感 (1-5)"]) || 3, sour: parseInt(row["酸度 (1-5)"]) || 3,
        tags: (row["標籤 (用逗號隔開)"] || "").toString().split(',').map(t => t.trim()).filter(t => t), description: finalDesc.trim()
    };
});

fs.writeFileSync(recipePath, JSON.stringify(recipeDatabase, null, 4), 'utf8');
console.log("🎉 已成功從 Excel 讀取並更新 recipe.json！請重啟您的伺服器 (node server.js)。");