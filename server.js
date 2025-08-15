
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
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL
    )`);
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

// 提供首页（嵌入式HTML）
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 获取产品列表
app.get('/api/products', (req, res) => {
    db.all(`SELECT * FROM products`, [], (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

// 添加产品
app.post('/api/products', (req, res) => {
    const { name, price } = req.body;
    db.run(`INSERT INTO products (name, price) VALUES (?, ?)`, [name, price], function(err) {
        if (err) return res.status(500).json({error: err.message});
        res.json({ id: this.lastID });
    });
});

// 创建订单
app.post('/api/orders', (req, res) => {
    const { items } = req.body;
    const createdAt = new Date().toISOString();

    let total = 0;
    items.forEach(item => {
        const subtotal = (item.price + (item.discount || 0)) * item.quantity;
        item.subtotal = subtotal;
        total += subtotal;
    });

    db.run(`INSERT INTO orders (created_at, total) VALUES (?, ?)`, [createdAt, total], function(err) {
        if (err) return res.status(500).json({error: err.message});
        const orderId = this.lastID;
        const stmt = db.prepare(`INSERT INTO order_items (order_id, product_name, quantity, price, discount, subtotal) VALUES (?, ?, ?, ?, ?, ?)`);
        items.forEach(item => {
            stmt.run(orderId, item.product_name, item.quantity, item.price, item.discount || 0, item.subtotal);
        });
        stmt.finalize();
        res.json({ id: orderId });
    });
});

// 获取当天订单和统计
app.get('/api/orders/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    db.all(`SELECT * FROM orders WHERE date(created_at) = ?`, [today], (err, orders) => {
        if (err) return res.status(500).json({error: err.message});

        db.all(`SELECT product_name, SUM(quantity) as total_qty, SUM(subtotal) as total_amount 
                FROM order_items oi 
                JOIN orders o ON oi.order_id = o.id 
                WHERE date(o.created_at) = ? 
                GROUP BY product_name`, [today], (err, products) => {
            if (err) return res.status(500).json({error: err.message});

            const orderCount = orders.length;
            const totalQty = products.reduce((sum, p) => sum + p.total_qty, 0);
            const totalAmount = orders.reduce((sum, o) => sum + o.total, 0);
            res.json({ orderCount, totalQty, totalAmount, products, orders });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
