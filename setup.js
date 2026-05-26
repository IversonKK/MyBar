const fs = require('fs');
const path = require('path');

const projectStructure = {
  'package.json': {
    "name": "home-bar-system",
    "version": "1.0.0",
    "main": "server.js",
    "dependencies": {
      "express": "^4.18.2",
      "socket.io": "^4.7.2"
    }
  },
  'server.js': `
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

const drinks = [
    { id: 1, name: 'Mojito', description: '薄荷、蘭姆酒、碎冰 — 清爽首選' },
    { id: 2, name: 'Old Fashioned', description: '威士忌、苦精、橙皮 — 經典優雅' },
    { id: 3, name: 'Gin Tonic', description: '琴酒、通寧水、檸檬 — 簡單純粹' },
    { id: 4, name: 'Negroni', description: '琴酒、金巴利、香艾酒 — 苦甜交織' },
    { id: 5, name: 'Whiskey Sour', description: '威士忌、檸檬、糖漿 — 酸甜平衡' },
    { id: 6, name: 'Margarita', description: '龍舌蘭、橙酒、萊姆汁 — 墨西哥風情' },
    { id: 7, name: 'Martini', description: '琴酒、乾香艾酒 — 雞尾酒之王' },
    { id: 8, name: 'Espresso Martini', description: '伏特加、濃縮咖啡、咖啡酒 — 提神必備' }
];

app.get('/api/drinks', (req, res) => res.json(drinks));

io.on('connection', (socket) => {
    socket.on('new-order', (orderData) => {
        io.emit('admin-notification', orderData);
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('-------------------------------------------');
    console.log('酒吧系統已啟動！');
    console.log('1. 酒保畫面 (請在電腦打開): http://localhost:' + PORT + '/dashboard.html');
    console.log('2. 客人點餐 (手機掃描): http://[你的IP]:' + PORT);
    console.log('-------------------------------------------');
});
`,
  'public/index.html': `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Home Bar Menu</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { font-family: -apple-system, sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 20px; }
        #menu { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 15px; }
        .card { background: #1e1e1e; border-radius: 15px; padding: 20px; border: 1px solid #333; display: flex; flex-direction: column; justify-content: space-between; }
        h1 { color: #f39c12; text-align: center; }
        button { background: #f39c12; color: black; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; width: 100%; }
        button:active { background: #e67e22; }
    </style>
</head>
<body>
    <h1>🍸 Private Bar</h1>
    <div id="menu"></div>
    <script>
        const socket = io();
        fetch('/api/drinks').then(r => r.json()).then(drinks => {
            const menu = document.getElementById('menu');
            drinks.forEach(d => {
                menu.innerHTML += '<div class="card"><h3>' + d.name + '</h3><p>' + d.description + '</p><button onclick="order(\\'' + d.name + '\\')">點這杯</button></div>';
            });
        });
        function order(name) {
            const guest = prompt("請問怎麼稱呼您？") || "嘉賓";
            socket.emit('new-order', { guest, drink: name, time: new Date().toLocaleTimeString() });
            alert('訂單已送出！');
        }
    </script>
</body>
</html>
`,
  'public/dashboard.html': `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Bar Management</title>
    <script src="/socket.io/socket.io.js"></script>
    <style>
        body { font-family: sans-serif; background: #f4f4f9; padding: 40px; }
        .order { background: white; padding: 20px; border-radius: 10px; margin-bottom: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); border-left: 8px solid #f39c12; }
    </style>
</head>
<body>
    <h1>📝 接單大螢幕</h1>
    <div id="list"></div>
    <script>
        const socket = io();
        socket.on('admin-notification', (data) => {
            const div = document.createElement('div');
            div.className = 'order';
            div.innerHTML = '<h2>' + data.guest + ' 點了：' + data.drink + '</h2><small>' + data.time + '</small>';
            document.getElementById('list').prepend(div);
            new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(()=>{});
        });
    </script>
</body>
</html>
`
};

// 執行建立動作
Object.entries(projectStructure).forEach(([filePath, content]) => {
  const fullPath = path.join(__dirname, filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
});

console.log("專案檔案已生成成功！");
