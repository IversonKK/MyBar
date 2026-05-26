const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const recipePath = path.join(__dirname, 'recipe.json');
const excelPath = path.join(__dirname, 'menu_database.xlsx');

if (!fs.existsSync(recipePath)) {
    console.log("找不到 recipe.json，無法匯出。");
    process.exit(1);
}

const recipeDatabase = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
const rows = [];

for (const [name, info] of Object.entries(recipeDatabase)) {
    let materials = "", method = "", cup = "", garnish = "", story = "";
    const descLines = (info.description || "").split('\n');
    let storyLines = [];

    descLines.forEach(line => {
        if (line.startsWith('材料：')) materials = line.replace('材料：', '');
        else if (line.startsWith('技法：')) method = line.replace('技法：', '');
        else if (line.startsWith('杯型：')) cup = line.replace('杯型：', '');
        else if (line.startsWith('裝飾：')) garnish = line.replace('裝飾：', '');
        else storyLines.push(line);
    });

    // 將資料推入 Excel 欄位中
    rows.push({
        "酒名 (必須與圖片同名)": name, "濃度 (%)": info.abv || 15, "酒感 (1-5)": info.strong || 3, "酸度 (1-5)": info.sour || 3, "標籤 (用逗號隔開)": (info.tags || []).join(', '),
        "材料": materials, "技法": method, "杯型": cup, "裝飾": garnish, "故事與敘述": storyLines.join('\n')
    });
}

const ws = xlsx.utils.json_to_sheet(rows);
const wb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(wb, ws, "酒單配方");
xlsx.writeFile(wb, excelPath);

console.log("🎉 已成功將目前配方匯出至 menu_database.xlsx！請用 Excel 打開它看看。");