const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const excelPath = path.join(__dirname, 'menu_database.xlsx');
const imagesDir = path.join(__dirname, 'public', 'images');

if (!fs.existsSync(excelPath)) {
    console.log('找不到 menu_database.xlsx，請先確保 Excel 檔案存在！');
    process.exit(1);
}

const wb = xlsx.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(ws);

// 1. 取得 Excel 中的所有酒名
const excelDrinkNames = data.map(row => row["酒名 (必須與圖片同名)"]).filter(name => name);

// 2. 取得圖片資料夾中的所有圖片檔名 (不含副檔名)
let imageNames = [];
if (fs.existsSync(imagesDir)) {
    const files = fs.readdirSync(imagesDir);
    imageNames = files
        .filter(file => file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png'))
        .map(file => file.replace(/\.(jpg|png)$/i, ''));
}

// 3. 比對找出 Excel 有，但資料夾裡沒有圖片的酒
const missingImages = excelDrinkNames.filter(name => !imageNames.includes(name));

console.log(`📊 系統總共檢查了 ${excelDrinkNames.length} 款 Excel 酒單配方...`);

if (missingImages.length === 0) {
    console.log('🎉 太神啦！所有 Excel 上的酒款都有對應的圖片，完美無瑕！');
} else {
    console.log(`⚠️ 發現 ${missingImages.length} 款酒缺少圖片，請補齊以下檔案：\n`);
    missingImages.forEach((name, index) => {
        console.log(`   ${index + 1}. ${name}.jpg`);
    });
    console.log('\n💡 小提醒：補齊圖片後不需要重啟伺服器，客人重整畫面就會自動顯示囉！');
}