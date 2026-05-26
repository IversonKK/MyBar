const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const docsDir = path.join(__dirname, 'WORD_1');
const recipePath = path.join(__dirname, 'recipe.json');

async function processWordDocs() {
    let recipeDatabase = {};
    if (fs.existsSync(recipePath)) {
        recipeDatabase = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
    }

    // 收集所有已知的酒名 (從 recipe.json 及圖片目錄收集)，用作比對基準
    let knownNames = Object.keys(recipeDatabase);
    const imagesDir = path.join(__dirname, 'public', 'images');
    if (fs.existsSync(imagesDir)) {
        fs.readdirSync(imagesDir).forEach(f => {
            if (f.toLowerCase().endsWith('.jpg') || f.toLowerCase().endsWith('.png')) {
                const imgName = f.replace(/\.(jpg|png)$/i, '');
                if (!knownNames.includes(imgName)) knownNames.push(imgName);
            }
        });
    }

    if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
        console.log('📂 已自動幫您建立 WORD_1 資料夾！請把 Word 檔 (.docx) 丟進去後再執行一次腳本。');
        return;
    }

    const files = fs.readdirSync(docsDir).filter(file => file.toLowerCase().endsWith('.docx'));
    
    if (files.length === 0) {
        console.log('⚠️ 在 WORD_1 資料夾中找不到任何 .docx 檔案喔！');
        return;
    }

    console.log(`找到 ${files.length} 個 Word 檔案，開始高速讀取與解析...\n`);

    for (const file of files) {
        const rawDrinkName = file.replace(/\.(docx)$/i, '');
        const docPath = path.join(docsDir, file);

        // --- 智慧模糊比對邏輯 ---
        let drinkName = rawDrinkName;
        // 將文字轉小寫，並去除所有非英數及非中文的字元 (包含空白與標點符號)
        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
        const normalizedRaw = normalize(rawDrinkName);
        
        // 1. 完全忽略符號與大小寫的精準比對
        let matchedKey = knownNames.find(key => normalize(key) === normalizedRaw);

        // 2. 子字串包含比對 (例如 Word 叫 "B52"，圖片叫 "B52轟炸機")
        if (!matchedKey && normalizedRaw.length >= 2) {
            matchedKey = knownNames.find(key => {
                const normKey = normalize(key);
                return normKey.includes(normalizedRaw) || normalizedRaw.includes(normKey);
            });
            if (matchedKey) {
                console.log(`💡 相似比對成功：[${rawDrinkName}.docx] ➝ 自動對應至現有酒款 [${matchedKey}]`);
            }
        } else if (matchedKey && matchedKey !== rawDrinkName) {
            console.log(`🔍 模糊容錯成功：[${rawDrinkName}.docx] ➝ 自動對應至現有酒款 [${matchedKey}]`);
        }

        if (matchedKey) {
            drinkName = matchedKey;
        }

        try {
            // 1. 使用 mammoth 讀取 word 檔的純文字
            const result = await mammoth.extractRawText({ path: docPath });
            const text = result.value;
            
            // 2. 將文字依換行拆分 (Word 文字很乾淨，不需做亂碼修正)
            const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
            
            if (lines.length > 0) {
                let ingredients = [];
                let methodLines = [];
                let cup = "";
                let garnish = "";
                let others = [];

                let currentSection = "none";

                lines.forEach(line => {
                    if (line.length < 2 || line === drinkName) return;
                    const lowerLine = line.toLowerCase();

                    // 智慧分類邏輯 (同前)
                    if (line.includes('材料') || line.includes('比例')) {
                        currentSection = "ingredients";
                        return;
                    } else if (line.includes('調製') || line.includes('方法') || line.includes('作法') || line.includes('技法')) {
                        currentSection = "method";
                        return;
                    }

                    if (line.includes('杯') && !lowerLine.includes('ml') && !lowerLine.includes('oz') && line.length < 15) {
                        cup = line.replace(/(杯型|建議杯型|杯子)[：:\s]*/i, '').replace(/^[^\u4e00-\u9fa5a-zA-Z]+/, '');
                        return;
                    }
                    if (line.includes('裝飾') || line.includes('裝點') || lowerLine.includes('garnish')) {
                        garnish = line.replace(/(裝飾|裝點|Garnish)[：:\s]*/i, '').replace(/^[^\u4e00-\u9fa5a-zA-Z]+/, '');
                        return;
                    }

                    if (currentSection === "ingredients") {
                        let cleaned = line.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '');
                        if (cleaned.length > 0) {
                            if (/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*(ml|oz|dash|滴|份|cc|g|克|片|塊|匙)$/i.test(cleaned) && ingredients.length > 0) {
                                ingredients[ingredients.length - 1] += ` ${cleaned}`;
                            } else {
                                ingredients.push(cleaned);
                            }
                        }
                    } else if (currentSection === "method") {
                        methodLines.push(line);
                    } else {
                        const hasUnit = /\d+\s*(ml|oz|dash|滴|份|cc|g|克|片|塊|匙)/i.test(line);
                        const isStep = /^[1-9][\.、\s]/.test(line);
                        const isJustUnit = /^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s*(ml|oz|dash|滴|份|cc|g|克|片|塊|匙)$/i.test(line.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, ''));

                        if (isJustUnit && ingredients.length > 0) {
                             ingredients[ingredients.length - 1] += ` ${line.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, '')}`;
                        } else if (hasUnit && !isStep) {
                            ingredients.push(line.replace(/^[^\u4e00-\u9fa5a-zA-Z0-9]+/, ''));
                        } else if (isStep || lowerLine.includes('shake') || lowerLine.includes('stir') || line.includes('搖盪') || line.includes('攪拌')) {
                            methodLines.push(line);
                        } else {
                            others.push(line);
                        }
                    }
                });

                let finalDesc = "";
                if (ingredients.length > 0) finalDesc += `材料：${ingredients.join(', ')}\n`;
                if (methodLines.length > 0) finalDesc += `技法：${methodLines.join('。')}\n`;
                if (cup) finalDesc += `杯型：${cup}\n`;
                if (garnish) finalDesc += `裝飾：${garnish}\n`;
                if (others.length > 0) finalDesc += others.join('\n');

                if (!recipeDatabase[drinkName]) {
                    recipeDatabase[drinkName] = { abv: 15, strong: 3, sour: 3, tags: ["其他"], description: "" };
                }
                
                recipeDatabase[drinkName].description = finalDesc.trim();
                console.log(`[成功] ✅ 讀取並更新了 ${drinkName} 的配方！`);
            } else {
                console.log(`[略過] ⚠️ ${drinkName}.docx 裡面沒有文字。`);
            }
        } catch (error) {
            console.error(`[失敗] ❌ 讀取 ${file} 時發生錯誤:`, error.message);
        }
    }

    // 寫入檔案
    fs.writeFileSync(recipePath, JSON.stringify(recipeDatabase, null, 4), 'utf8');
    console.log('\n🎉 所有 Word 檔案讀取完畢，已成功更新 recipe.json！請重新啟動您的伺服器。');
}

processWordDocs();
