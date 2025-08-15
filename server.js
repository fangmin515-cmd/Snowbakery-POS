
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const dbFile = path.join(__dirname, 'orders.db');
const db = new sqlite3.Database(dbFile);

app.use(bodyParser.json());
app.use(express.static(__dirname));

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
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
        product_id INTEGER,
        product_name TEXT,
        quantity INTEGER,
        price REAL,
        discount REAL,
        subtotal REAL
    )`);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/products', (req, res) => {
    db.all('SELECT * FROM products', [], (err, rows) => {
        if(err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/products', (req,res) => {
    const {name,price} = req.body;
    db.run('INSERT OR IGNORE INTO products (name,price) VALUES (?,?)',[name,price], function(err){
        if(err) return res.status(500).json({error:err.message});
        res.json({id:this.lastID});
    });
});

app.post('/api/orders',(req,res) => {
    const {items} = req.body;
    const createdAt = new Date().toISOString();
    let total = 0;
    items.forEach(it => { it.subtotal = (it.price - it.discount) * it.quantity; total += it.subtotal; });
    db.run('INSERT INTO orders (created_at,total) VALUES (?,?)',[createdAt,total], function(err){
        if(err) return res.status(500).json({error: err.message});
        const orderId = this.lastID;
        const stmt = db.prepare('INSERT INTO order_items (order_id,product_id,product_name,quantity,price,discount,subtotal) VALUES (?,?,?,?,?,?,?)');
        items.forEach(it => stmt.run(orderId,it.product_id,it.product_name,it.quantity,it.price,it.discount,it.subtotal));
        stmt.finalize();
        res.json({id: orderId});
    });
});

app.get('/api/orders/today',(req,res) => {
    const today = new Date().toISOString().split('T')[0];
    db.all('SELECT * FROM orders WHERE date(created_at)=?',[today],(err,orders) => {
        if(err) return res.status(500).json({error:err.message});
        const orderIds = orders.map(o=>o.id);
        if(orderIds.length===0) return res.json({orderCount:0,totalQty:0,totalAmount:0,products:[],orders:[]});
        db.all(`SELECT * FROM order_items WHERE order_id IN (${orderIds.join(',')})`, (err,items) => {
            if(err) return res.status(500).json({error: err.message});
            const productsMap = {};
            items.forEach(i => {
                if(!productsMap[i.product_name]) productsMap[i.product_name]={product_name:i.product_name,total_qty:0,total_amount:0};
                productsMap[i.product_name].total_qty += i.quantity;
                productsMap[i.product_name].total_amount += i.subtotal;
            });
            const productSummary = Object.values(productsMap);
            res.json({orderCount: orders.length, totalQty: items.reduce((a,b)=>a+b.quantity,0), totalAmount: items.reduce((a,b)=>a+b.subtotal,0), products: productSummary, orders: orders.map(o=>{return {id:o.id, created_at:o.created_at, items: items.filter(it=>it.order_id===o.id)}})});
        });
    });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
