const fs = require('fs');
const path = require('path');

// 您圖片的資料夾路徑
const imagesDir = path.join(__dirname, 'public', 'images');
// 輸出的 JSON 檔案路徑
const outputFile = path.join(__dirname, 'recipe.json');

// 內建的超大型經典調酒配方庫
const builtinDatabase = {
    "莫希托": { abv: 12, strong: 2, sour: 4, tags: ["蘭姆酒", "有氣泡"], description: "材料：白蘭姆酒、薄荷葉、砂糖、萊姆汁、蘇打水。杯型：高球杯。裝飾：薄荷葉、萊姆角。" },
    "瑪格麗特": { abv: 20, strong: 4, sour: 4, tags: ["龍舌蘭", "無氣泡"], description: "材料：龍舌蘭、君度橙酒、新鮮萊姆汁。杯型：瑪格麗特杯。裝飾：鹽口、萊姆片。" },
    "長島冰茶": { abv: 28, strong: 5, sour: 3, tags: ["伏特加", "琴酒", "蘭姆酒", "龍舌蘭"], description: "材料：琴酒、伏特加、蘭姆酒、龍舌蘭、君度橙酒、檸檬汁、可樂。杯型：高球杯。裝飾：檸檬片。" },
    "古典雞尾酒": { abv: 30, strong: 5, sour: 1, tags: ["威士忌", "無氣泡"], description: "材料：波本威士忌、安格氏苦精、方糖、少許水。杯型：古典杯。裝飾：橙皮。" },
    "琴通寧": { abv: 10, strong: 2, sour: 2, tags: ["琴酒", "有氣泡"], description: "材料：琴酒、通寧水。杯型：高球杯。裝飾：檸檬角。" },
    "金湯力": { abv: 10, strong: 2, sour: 2, tags: ["琴酒", "有氣泡"], description: "材料：琴酒、通寧水。杯型：高球杯。裝飾：檸檬角。" },
    "內格羅尼": { abv: 25, strong: 4, sour: 2, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、金巴利、甜苦艾酒。杯型：古典杯。裝飾：橙皮。" },
    "曼哈頓": { abv: 30, "strong": 5, sour: 2, tags: ["威士忌", "無氣泡"], description: "材料：裸麥威士忌、甜苦艾酒、安格氏苦精。杯型：馬丁尼杯。裝飾：酒漬櫻桃。" },
    "馬丁尼": { abv: 32, strong: 5, sour: 1, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、不甜苦艾酒。杯型：馬丁尼杯。裝飾：橄欖或檸檬皮。" },
    "莫斯科騾子": { abv: 12, strong: 2, sour: 3, tags: ["伏特加", "有氣泡"], description: "材料：伏特加、薑汁啤酒、萊姆汁。杯型：銅杯。裝飾：萊姆角。" },
    "側車": { abv: 25, strong: 4, sour: 3, tags: ["白蘭地", "無氣泡"], description: "材料：干邑白蘭地、君度橙酒、檸檬汁。杯型：馬丁尼杯。裝飾：糖口(選用)、橙皮。" },
    "濃縮咖啡馬丁尼": { abv: 15, strong: 3, sour: 1, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、咖啡利口酒、濃縮咖啡。杯型：馬丁尼杯。裝飾：三顆咖啡豆。" },
    "鳳梨可樂達": { abv: 10, strong: 2, sour: 2, tags: ["蘭姆酒", "其他"], description: "材料：白蘭姆酒、椰奶、鳳梨汁。杯型：颶風杯。裝飾：鳳梨片、櫻桃。" },
    "柯夢波丹": { abv: 15, strong: 3, sour: 3, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、君度橙酒、蔓越莓汁、萊姆汁。杯型：馬丁尼杯。裝飾：橙皮。" },
    "血腥瑪麗": { abv: 12, strong: 2, sour: 2, tags: ["伏特加", "其他"], description: "材料：伏特加、番茄汁、辣醬、胡椒、芹菜鹽。杯型：高球杯。裝飾：芹菜梗、檸檬角。" },
    "龍舌蘭日出": { abv: 12, strong: 2, sour: 3, tags: ["龍舌蘭", "無氣泡"], description: "材料：龍舌蘭、柳橙汁、紅石榴糖漿。杯型：高球杯。裝飾：柳橙片、櫻桃。" },
    "邁泰": { abv: 22, strong: 4, sour: 3, tags: ["蘭姆酒", "無氣泡"], description: "材料：深色蘭姆酒、橙酒、杏仁糖漿、萊姆汁。杯型：古典杯。裝飾：薄荷葉、鳳梨角。" },
    "新加坡司令": { abv: 15, strong: 3, sour: 3, tags: ["琴酒", "有氣泡"], description: "材料：琴酒、櫻桃白蘭地、鳳梨汁、檸檬汁、蘇打水。杯型：司令杯。裝飾：鳳梨片、櫻桃。" },
    "白色俄羅斯": { abv: 18, strong: 3, sour: 1, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、咖啡利口酒、鮮奶油。杯型：古典杯。裝飾：無。" },
    "黑色俄羅斯": { abv: 25, strong: 4, sour: 1, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、咖啡利口酒。杯型：古典杯。裝飾：無。" },
    "自由古巴": { abv: 15, strong: 3, sour: 2, tags: ["蘭姆酒", "有氣泡"], description: "材料：白蘭姆酒、可樂、萊姆汁。杯型：高球杯。裝飾：萊姆角。" },
    "威士忌酸酒": { abv: 15, strong: 3, sour: 4, tags: ["威士忌", "無氣泡"], description: "材料：波本威士忌、檸檬汁、糖漿、蛋白。杯型：古典杯。裝飾：橙片、櫻桃。" },
    "教父": { abv: 30, strong: 5, sour: 1, tags: ["威士忌", "無氣泡"], description: "材料：蘇格蘭威士忌、杏仁酒。杯型：古典杯。裝飾：無。" },
    "教母": { abv: 25, strong: 4, sour: 1, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、杏仁酒。杯型：古典杯。裝飾：無。" },
    "螺絲起子": { abv: 15, strong: 2, sour: 2, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、柳橙汁。杯型：高球杯。裝飾：柳橙片。" },
    "鹹狗": { abv: 15, strong: 2, sour: 3, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、葡萄柚汁。杯型：高球杯。裝飾：鹽口、葡萄柚片。" },
    "海風": { abv: 15, strong: 2, sour: 2, tags: ["伏特加", "無氣泡"], description: "材料：伏特加、蔓越莓汁、葡萄柚汁。杯型：高球杯。裝飾：萊姆片。" },
    "琴費士": { abv: 15, strong: 3, sour: 4, tags: ["琴酒", "有氣泡"], description: "材料：琴酒、檸檬汁、糖漿、蘇打水。杯型：高球杯。裝飾：檸檬片。" },
    "湯姆可林": { abv: 15, strong: 3, sour: 4, tags: ["琴酒", "有氣泡"], description: "材料：老湯姆琴酒、檸檬汁、糖漿、蘇打水。杯型：高球杯。裝飾：檸檬片、櫻桃。" },
    "琴蕾": { abv: 20, strong: 4, sour: 3, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、萊姆汁。杯型：馬丁尼杯。裝飾：萊姆片。" },
    "環遊世界": { abv: 20, strong: 4, sour: 3, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、綠薄荷酒、鳳梨汁、檸檬汁。杯型：馬丁尼杯。裝飾：薄荷葉。" },
    "B52轟炸機": { abv: 25, strong: 5, sour: 1, tags: ["其他", "無氣泡"], description: "材料：咖啡利口酒、貝禮詩奶酒、君度橙酒。杯型：一口杯。裝飾：點火(選用)。" },
    "龍舌蘭蹦": { abv: 20, strong: 4, sour: 1, tags: ["龍舌蘭", "有氣泡"], description: "材料：龍舌蘭、雪碧或蘇打水。杯型：古典杯。裝飾：無。" },
    "黛克瑞": { abv: 18, strong: 3, sour: 4, tags: ["蘭姆酒", "無氣泡"], description: "材料：白蘭姆酒、萊姆汁、糖漿。杯型：馬丁尼杯。裝飾：萊姆片。" },
    "藍色夏威夷": { abv: 15, strong: 2, sour: 3, tags: ["蘭姆酒", "其他"], description: "材料：白蘭姆酒、藍柑橘酒、鳳梨汁、椰奶。杯型：颶風杯。裝飾：鳳梨片、櫻桃。" },
    "椰林風情": { abv: 0, strong: 1, sour: 2, tags: ["無酒精", "其他"], description: "材料：椰奶、鳳梨汁、鮮奶油。杯型：颶風杯。裝飾：鳳梨片、櫻桃。" },
    "灰狗": { abv: 15, strong: 2, sour: 3, tags: ["琴酒", "伏特加", "無氣泡"], description: "材料：琴酒或伏特加、葡萄柚汁。杯型：高球杯。裝飾：葡萄柚片。" },
    "金巴利蘇打": { abv: 10, strong: 2, sour: 2, tags: ["其他", "有氣泡"], description: "材料：金巴利利口酒、蘇打水。杯型：高球杯。裝飾：柳橙片。" },
    "阿佩羅蘇打": { abv: 8, strong: 1, sour: 2, tags: ["其他", "有氣泡"], description: "材料：阿佩羅利口酒、普羅賽克氣泡酒、蘇打水。杯型：葡萄酒杯。裝飾：柳橙片。" },
    "黑風暴": { abv: 18, strong: 3, sour: 2, tags: ["蘭姆酒", "有氣泡"], description: "材料：黑蘭姆酒、薑汁啤酒、萊姆汁。杯型：高球杯。裝飾：萊姆角。" },
    "愛爾蘭咖啡": { abv: 15, strong: 3, sour: 1, tags: ["威士忌", "其他"], description: "材料：愛爾蘭威士忌、咖啡、糖、鮮奶油。杯型：愛爾蘭咖啡杯。裝飾：無。" },
    "熱托迪": { abv: 20, strong: 4, sour: 2, tags: ["威士忌", "其他"], description: "材料：威士忌、熱水、檸檬汁、蜂蜜。杯型：耐熱杯。裝飾：檸檬片、丁香。" },
    "白蘭地亞歷山大": { abv: 20, strong: 3, sour: 1, tags: ["白蘭地", "無氣泡"], description: "材料：白蘭地、可可利口酒、鮮奶油。杯型：馬丁尼杯。裝飾：肉豆蔻粉。" },
    "蚱蜢": { abv: 15, strong: 2, sour: 1, tags: ["其他", "無氣泡"], description: "材料：綠薄荷酒、白可可利口酒、鮮奶油。杯型：馬丁尼杯。裝飾：巧克力碎。" },
    "蜜蜂膝": { abv: 20, strong: 3, sour: 4, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、檸檬汁、蜂蜜糖漿。杯型：馬丁尼杯。裝飾：檸檬皮。" },
    "航空": { abv: 20, strong: 3, sour: 3, tags: ["琴酒", "無氣泡"], description: "材料：琴酒、黑櫻桃利口酒、檸檬汁、紫羅蘭利口酒。杯型：馬丁尼杯。裝飾：櫻桃。" },
    "法蘭西75": { abv: 15, strong: 2, sour: 3, tags: ["琴酒", "有氣泡"], description: "材料：琴酒、檸檬汁、糖漿、香檳。杯型：香檳杯。裝飾：檸檬皮。" },
    "青草蜢": { abv: 15, strong: 2, sour: 1, tags: ["其他", "無氣泡"], description: "材料：綠薄荷酒、白可可酒、鮮奶油。杯型：馬丁尼杯。裝飾：薄荷葉。" },
    "銹釘": { abv: 30, strong: 5, sour: 1, tags: ["威士忌", "無氣泡"], description: "材料：蘇格蘭威士忌、蜂蜜利口酒(Drambuie)。杯型：古典杯。裝飾：檸檬皮。" }
};

let generatedRecipe = {};
let matchCount = 0;
let missingCount = 0;

try {
    // 1. 讀取現有的 recipe.json (如果有的話)，避免覆蓋掉您自己手動修改過的資料
    if (fs.existsSync(outputFile)) {
        const existingData = fs.readFileSync(outputFile, 'utf8');
        generatedRecipe = JSON.parse(existingData);
    }

    // 2. 掃描 JPG_1 資料夾
    const files = fs.readdirSync(imagesDir);
    
    files.forEach(file => {
        if (file.toLowerCase().endsWith('.jpg') || file.toLowerCase().endsWith('.png')) {
            const rawDrinkName = file.replace(/\.(jpg|png)$/i, '');
            const drinkName = rawDrinkName.trim(); // 去除檔名頭尾可能的空白
            
            // 判斷原本是否為「配方待補充」的佔位符
            const isPlaceholder = generatedRecipe[drinkName] && generatedRecipe[drinkName].description.includes("配方待補充");
            
            // 如果資料已經存在，且「不是」佔位符 (代表您可能有手動編輯過)，才保留不覆蓋
            if (generatedRecipe[drinkName] && !isPlaceholder) {
                return; 
            }

            // 模糊比對：檢查檔名是否「包含」內建資料庫的關鍵字 (解決檔名有前綴、後綴或英文的問題)
            let matchedKey = null;
            for (const key in builtinDatabase) {
                if (drinkName.includes(key)) {
                    matchedKey = key;
                    break;
                }
            }

            if (matchedKey) {
                generatedRecipe[drinkName] = builtinDatabase[matchedKey];
                matchCount++;
            } else {
                // 如果連內建資料庫都沒有，只好塞入佔位符，您可以之後手動改 JSON
                generatedRecipe[drinkName] = {
                    abv: 15,
                    strong: 3,
                    sour: 3,
                    tags: ["其他"],
                    description: "材料：配方待補充。杯型：待確認。裝飾：無。"
                };
                missingCount++;
            }
        }
    });

    // 3. 將最終結果寫入 recipe.json
    fs.writeFileSync(outputFile, JSON.stringify(generatedRecipe, null, 2), 'utf8');
    
    console.log(`✅ 生成成功！`);
    console.log(`- 成功從內建資料庫匹配並補齊了 ${matchCount} 款酒的配方。`);
    console.log(`- 有 ${missingCount} 款酒較為冷門，已填入「配方待補充」的預設格式。`);
    console.log(`請打開 recipe.json 檢查，或者直接啟動您的 node server.js！`);

} catch (err) {
    console.error("生成失敗，請確認 public/images 資料夾是否存在:", err);
}