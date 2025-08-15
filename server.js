const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// 初始化数据库
const db = new Database('db.sqlite');
db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        date TEXT,
        total REAL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT,
        product TEXT,
        qty INTEGER,
        price REAL,
        discount REAL,
        subtotal REAL
    )
`).run();

// 提供前端 HTML
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>烘焙店收银系统</title>
<style>
    body { font-family: Arial; margin: 20px; }
    table { border-collapse: collapse; width: 100%; margin-top: 10px; }
    th, td { border: 1px solid #ccc; padding: 6px; text-align: center; }
    input { padding: 4px; }
    .flex { display: flex; gap: 10px; margin-bottom: 10px; }
</style>
</head>
<body>
<h1>烘焙店收银系统</h1>

<div id="order-form">
    <h3>新订单</h3>
    <table id="order-table">
        <thead>
            <tr><th>产品名</th><th>单价</th><th>数量</th><th>优惠金额</th><th>操作</th></tr>
        </thead>
        <tbody></tbody>
    </table>
    <button onclick="addRow()">添加产品</button>
    <div style="margin-top: 10px;">
        <button onclick="saveOrder()">保存订单</button>
    </div>
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
            product: inputs[0].value,
            price: parseFloat(inputs[1].value),
            qty: parseInt(inputs[2].value),
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
    fetch('/api/orders/today-summary').then(r => r.json()).then(data => {
        document.getElementById('summary').innerHTML = \`
            订单数：\${data.orderCount} | 总件数：\${data.totalQty} | 营业额：\${data.totalAmount.toFixed(2)}
        \`;
        let ps = '<table><tr><th>产品</th><th>销量</th><th>销售额</th></tr>';
        data.productSummary.forEach(p => {
            ps += \`<tr><td>\${p.product}</td><td>\${p.qty}</td><td>\${p.amount.toFixed(2)}</td></tr>\`;
        });
        ps += '</table>';
        document.getElementById('product-summary').innerHTML = ps;
    });
    fetch('/api/orders/today').then(r => r.json()).then(data => {
        let html = '<table><tr><th>时间</th><th>产品</th><th>数量</th><th>单价</th><th>优惠</th><th>小计</th></tr>';
        data.forEach(o => {
            o.items.forEach(i => {
                html += \`<tr><td>\${o.date}</td><td>\${i.product}</td><td>\${i.qty}</td><td>\${i.price}</td><td>\${i.discount}</td><td>\${i.subtotal.toFixed(2)}</td></tr>\`;
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

// 保存订单
app.post('/api/orders', (req, res) => {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).send('无产品');
    const id = nanoid();
    const date = new Date().toISOString().split('T')[0];
    let total = 0;
    const insertOrderItem = db.prepare(`INSERT INTO order_items VALUES (?, ?, ?, ?, ?, ?, ?)`);
    items.forEach(it => {
        const subtotal = (it.price * it.qty) - it.discount;
        total += subtotal;
        insertOrderItem.run(nanoid(), id, it.product, it.qty, it.price, it.discount, subtotal);
    });
    db.prepare(`INSERT INTO orders VALUES (?, ?, ?)`).run(id, date, total);
    res.json({ id });
});

// 获取当天订单
app.get('/api/orders/today', (req, res) => {
    const date = new Date().toISOString().split('T')[0];
    const orders = db.prepare(`SELECT * FROM orders WHERE date = ?`).all(date);
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all;
    const result = orders.map(o => ({
        ...o,
        items: db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(o.id)
    }));
    res.json(result);
});

// 当天统计
app.get('/api/orders/today-summary', (req, res) => {
    const date = new Date().toISOString().split('T')[0];
    const orders = db.prepare(`SELECT * FROM orders WHERE date = ?`).all(date);
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id IN (${orders.map(o => `'${o.id}'`).join(',') || "''"})`).all();
    const totalAmount = orders.reduce((s, o) => s + o.total, 0);
    const totalQty = items.reduce((s, i) => s + i.qty, 0);
    const productMap = {};
    items.forEach(i => {
        if (!productMap[i.product]) productMap[i.product] = { product: i.product, qty: 0, amount: 0 };
        productMap[i.product].qty += i.qty;
        productMap[i.product].amount += i.subtotal;
    });
    res.json({
        orderCount: orders.length,
        totalQty,
        totalAmount,
        productSummary: Object.values(productMap)
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on ' + PORT));