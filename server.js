
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const dbFile = path.join(__dirname, 'orders.db');
const db = new sqlite3.Database(dbFile);

app.use(bodyParser.json());

// 初始化数据库
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT,
        total REAL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        product_name TEXT,
        quantity INTEGER,
        price REAL,
        discount REAL,
        subtotal REAL
    )`);
});

// 提供首页（完整前端嵌入HTML）
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>Snowtee POS 多商品下单系统</title>
<style>
body { font-family: Arial; margin: 20px; }
table { border-collapse: collapse; width: 100%; margin-top: 10px; }
th, td { border: 1px solid #ccc; padding: 6px; text-align: center; }
input { padding: 4px; }
button { padding: 6px 10px; margin: 2px; }
</style>
</head>
<body>
<h1>Snowtee POS 多商品下单系统</h1>

<div id="order-form">
<h3>新订单</h3>
<table id="order-table">
<thead>
<tr><th>产品名</th><th>单价</th><th>数量</th><th>优惠金额</th><th>操作</th></tr>
</thead>
<tbody></tbody>
</table>
<button onclick="addRow()">添加产品</button>
<br><br>
<button onclick="saveOrder()">保存订单</button>
</div>

<h3>当日统计</h3>
<div id="summary"></div>

<h3>各产品销量及金额</h3>
<div id="product-summary"></div>

<h3>当日订单明细</h3>
<div id="orders"></div>

<script>
function addRow(product='', price='', qty=1, discount=0) {
    const tbody = document.querySelector('#order-table tbody');
    const row = document.createElement('tr');
    row.innerHTML = \`
        <td><input value="\${product}"></td>
        <td><input type="number" step="0.01" value="\${price}"></td>
        <td><input type="number" value="\${qty}"></td>
        <td><input type="number" step="0.01" value="\${discount}"></td>
        <td><button onclick="this.parentElement.parentElement.remove()">删除</button></td>
    \`;
    tbody.appendChild(row);
}

function saveOrder() {
    const rows = document.querySelectorAll('#order-table tbody tr');
    const items = [];
    rows.forEach(r => {
        const inputs = r.querySelectorAll('input');
        items.push({
            product_name: inputs[0].value,
            price: parseFloat(inputs[1].value),
            quantity: parseInt(inputs[2].value),
            discount: parseFloat(inputs[3].value)
        });
    });
    fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
    }).then(r => r.json()).then(d => {
        alert('订单已保存');
        loadToday();
    });
}

function loadToday() {
    fetch('/api/orders/today').then(r => r.json()).then(data => {
        document.getElementById('summary').innerHTML = \`
订单数：\${data.orderCount} | 总件数：\${data.totalQty} | 营业额：\${data.totalAmount.toFixed(2)}
\`;
        let ps = '<table><tr><th>产品</th><th>销量</th><th>销售额</th></tr>';
        data.products.forEach(p => {
            ps += \`<tr><td>\${p.product_name}</td><td>\${p.total_qty}</td><td>\${p.total_amount.toFixed(2)}</td></tr>\`;
        });
        ps += '</table>';
        document.getElementById('product-summary').innerHTML = ps;

        let html = '<table><tr><th>订单ID</th><th>时间</th><th>产品</th><th>数量</th><th>单价</th><th>优惠</th><th>小计</th></tr>';
        data.orders.forEach(o => {
            o.items.forEach(i => {
                html += \`<tr><td>\${o.id}</td><td>\${o.created_at}</td><td>\${i.product_name}</td><td>\${i.quantity}</td><td>\${i.price}</td><td>\${i.discount}</td><td>\${i.subtotal.toFixed(2)}</td></tr>\`;
            });
        });
        html += '</table>';
        document.getElementById('orders').innerHTML = html;
    });
}

addRow();
loadToday();
</script>
</body>
</html>
    `);
});

// 创建订单接口
app.post('/api/orders', (req, res) => {
    const { items } = req.body;
    const createdAt = new Date().toISOString();
    let total = 0;
    items.forEach(it => {
        it.subtotal = (it.price - it.discount) * it.quantity;
        total += it.subtotal;
    });
    db.run(`INSERT INTO orders (created_at, total) VALUES (?, ?)`, [createdAt, total], function(err) {
        if (err) return res.status(500).json({error: err.message});
        const orderId = this.lastID;
        const stmt = db.prepare(`INSERT INTO order_items (order_id, product_name, quantity, price, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?)`);
        items.forEach(it => stmt.run(orderId, it.product_name, it.quantity, it.price, it.discount, it.subtotal));
        stmt.finalize();
        res.json({ id: orderId });
    });
});

// 获取当天订单和统计
app.get('/api/orders/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.all(`SELECT * FROM orders WHERE date(created_at) = ?`, [today], (err, orders) => {
        if (err) return res.status(500).json({error: err.message});
        const orderIds = orders.map(o => o.id);
        if (orderIds.length === 0) return res.json({orderCount:0, totalQty:0, totalAmount:0, products:[], orders:[]});
        db.all(`SELECT * FROM order_items WHERE order_id IN (${orderIds.join(',')})`, (err, items) => {
            if (err) return res.status(500).json({error: err.message});
            const productsMap = {};
            items.forEach(i => {
                if (!productsMap[i.product_name]) productsMap[i.product_name]={product_name:i.product_name,total_qty:0,total_amount:0};
                productsMap[i.product_name].total_qty += i.quantity;
                productsMap[i.product_name].total_amount += i.subtotal;
            });
            const totalQty = items.reduce((sum,i)=>sum+i.quantity,0);
            const totalAmount = orders.reduce((sum,o)=>sum+o.total,0);
            const productSummary = Object.values(productsMap);
            const orderMap = {};
            orders.forEach(o => orderMap[o.id]={...o,items:[]});
            items.forEach(i=>orderMap[i.order_id].items.push(i));
            res.json({orderCount:orders.length,totalQty,totalAmount,products:productSummary,orders:Object.values(orderMap)});
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT,()=>console.log('Server running on port '+PORT));
