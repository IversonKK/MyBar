const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const excelPath = path.join(__dirname, 'menu_database.xlsx');

if (!fs.existsSync(excelPath)) {
    console.log('找不到 menu_database.xlsx，請確認檔案存在！');
    process.exit(1);
}

const wb = xlsx.readFile(excelPath);
const ws = wb.Sheets[wb.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(ws);

let updatedCount = 0;

data.forEach(row => {
    let materials = row["材料"] || "";
    let garnish = row["裝飾"] || "";

    if (materials) {
        // 以逗號或換行將材料拆分開來
        let matArray = materials.split(/[,、，\n]/).map(s => s.trim()).filter(s => s);
        let keptMaterials = [];
        let movedGarnishes = [];

        matArray.forEach(mat => {
            // 智慧判斷：只要包含這些關鍵字，就認定是皮捲裝飾類
            if (/(皮捲|橙皮|檸檬皮|萊姆皮|柚子皮|葡萄柚皮|果皮)/.test(mat)) {
                movedGarnishes.push(mat);
            } else {
                keptMaterials.push(mat);
            }
        });

        if (movedGarnishes.length > 0) {
            // 更新材料欄位 (把皮捲拿掉)
            row["材料"] = keptMaterials.join(', ');
            
            // 更新裝飾欄位 (把皮捲加進去，並用逗號隔開原本就有的裝飾)
            let existingGarnish = garnish ? garnish + ', ' : '';
            row["裝飾"] = existingGarnish + movedGarnishes.join(', ');
            updatedCount++;
        }
    }
});

const newWs = xlsx.utils.json_to_sheet(data);
const newWb = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(newWb, newWs, wb.SheetNames[0]);
xlsx.writeFile(newWb, excelPath);

console.log(`🎉 掃描完畢！成功幫您將 ${updatedCount} 款酒的「皮捲裝飾」從材料移至裝飾欄位！`);
console.log(`👉 下一步：請執行 \`node import-excel.js\` 來更新系統，然後去 Dashboard 重載配方。`);