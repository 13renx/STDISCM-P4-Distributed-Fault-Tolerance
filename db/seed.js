// mongosh syntax
db = db.getSiblingDB('flowerbudsboutique'); // This creates/uses your DB

// Drop old data so you can re-run without duplicates
db.orders.drop();
db.products.drop();
db.sessions.drop();
db.shippings.drop();
db.users.drop();

db.products.insertMany([
    { 
        name: "Spring Arrangement", 
        price: 999, 
        isAvailable: true, 
        occasion: "any", 
        sold: 2, 
        stock: 25, 
        type: "arrangement", 
        imgSrc: "/images/product1.png", 
        color: "mixed" 
    },
    { 
        name: "Succulent Garden", 
        price: 999, 
        isAvailable: true, 
        occasion: "any", 
        sold: 1, 
        stock: 50, 
        type: "garden", 
        imgSrc: "/images/product2.png", 
        color: "mixed" 
    },
    { 
        name: "Rose Bouquet", 
        price: 999, 
        isAvailable: true, 
        occasion: "any", 
        sold: 1, 
        stock: 0, 
        type: "bouquet", 
        imgSrc: "/images/product3.png", 
        color: "red" 
    },
    { 
        name: "Sunflower Bouquet", 
        price: 999, 
        isAvailable: true, 
        occasion: "any", 
        sold: 1, 
        stock: 5, 
        type: "bouquet", 
        imgSrc: "/images/product6.png", 
        color: "yellow" 
    }
]);

db.users.insertMany([
    {
        username: "user01",
        email: "user01@email.com",
        password: "$2b$13$utsnRxUmRWIkP/ERWf6SRuoeLF3XYV.Yk9zKoX/UYxK1WZRjRyT4e", // 12345678
        orderIds: [],
        shippingId: null,
        isAdmin: false
    },
    {
        username: "admin01",
        email: "admin01@email.com",
        password: "$2b$13$utsnRxUmRWIkP/ERWf6SRuoeLF3XYV.Yk9zKoX/UYxK1WZRjRyT4e", // 12345678
        orderIds: [],
        shippingId: null,
        isAdmin: true
    }
])

print("✅ Seed data for flowerbudsboutique inserted");