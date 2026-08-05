require("dotenv").config();
const express = require("express");
const path = require("path");
const sql = require("mssql");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
console.log("DB_SERVER:", process.env.DB_SERVER);
console.log("DB_USER:", process.env.DB_USER);
console.log("DB_DATABASE:", process.env.DB_DATABASE);
console.log("DB_PASSWORD:", process.env.DB_PASSWORD ? "Loaded" : "Missing");
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: false
    }
};

// Kết nối Azure SQL
sql.connect(dbConfig)
.then(() => {
    console.log("✅ Connected to Azure SQL");
})
.catch(err => {
    console.error("❌ Database connection failed:", err);
});

// Trang chủ
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});


// =========================
// Đăng ký
// =========================
app.post("/register", async (req, res) => {

    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu."
        });
    }

    try {

        await sql.query`
            INSERT INTO Users (Username, Password)
            VALUES (${username}, ${password})
        `;

        res.json({
            success: true,
            message: "Đăng ký thành công."
        });

    } catch (err) {

        if (err.number === 2627 || err.number === 2601) {
            return res.json({
                success: false,
                message: "Tên đăng nhập đã tồn tại."
            });
        }

        res.json({
            success: false,
            message: err.message
        });

    }

});


// =========================
// Đăng nhập
// =========================
app.post("/login", async (req, res) => {

    const { username, password } = req.body;

    if (!username || !password) {
        return res.json({
            success: false,
            message: "Vui lòng nhập tài khoản và mật khẩu."
        });
    }

    try {

        const result = await sql.query`
            SELECT *
            FROM Users
            WHERE Username = ${username}
            AND Password = ${password}
        `;

        if (result.recordset.length === 0) {
            return res.json({
                success: false,
                message: "Sai tài khoản hoặc mật khẩu."
            });
        }

        res.json({
            success: true,
            message: "Đăng nhập thành công.",
            user: result.recordset[0]
        });

    } catch (err) {

        res.json({
            success: false,
            message: err.message
        });

    }

});


// =========================
// Lưu điểm
// =========================
app.post("/save-score", async (req, res) => {

    const { username, score } = req.body;

    if (!username) {
        return res.json({
            success: false,
            message: "Chưa đăng nhập."
        });
    }

    try {

        await sql.query`
            UPDATE Users
            SET HighScore =
            CASE
                WHEN HighScore < ${score}
                THEN ${score}
                ELSE HighScore
            END
            WHERE Username = ${username}
        `;

        res.json({
            success: true,
            message: "Đã lưu điểm."
        });

    } catch (err) {

        res.json({
            success: false,
            message: err.message
        });

    }

});


// =========================
// Leaderboard
// =========================
app.get("/leaderboard", async (req, res) => {

    try {

        const result = await sql.query`
            SELECT TOP 10 Username, HighScore
            FROM Users
            ORDER BY HighScore DESC
        `;

        res.json(result.recordset);

    } catch (err) {

        res.json([]);

    }

});

const port = process.env.PORT || 8080;

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});