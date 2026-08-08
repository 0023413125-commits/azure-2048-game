require("dotenv").config();
const express = require("express");
const path = require("path");
const sql = require("mssql");
const { BlobServiceClient } = require("@azure/storage-blob");
// =========================
// Azure Blob Storage
// =========================

if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    console.error("❌ AZURE_STORAGE_CONNECTION_STRING chưa được cấu hình trong .env");
    process.exit(1);
}

const blobServiceClient = BlobServiceClient.fromConnectionString(
    process.env.AZURE_STORAGE_CONNECTION_STRING
);

const containerClient =
    blobServiceClient.getContainerClient("game-data");

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
app.post("/save-score", async (req, res) => {
    const { username, score } = req.body;

    // Kiểm tra dữ liệu
    if (!username) {
        return res.status(400).json({
            success: false,
            message: "Chưa đăng nhập."
        });
    }

    const currentScore = Number(score);

    if (!Number.isFinite(currentScore) || currentScore < 0) {
        return res.status(400).json({
            success: false,
            message: "Điểm không hợp lệ."
        });
    }

    try {
        // =====================================
        // 1. Kiểm tra user có tồn tại không
        // =====================================
        const userResult = await sql.query`
            SELECT Username, ISNULL(HighScore, 0) AS HighScore
            FROM Users
            WHERE Username = ${username}
        `;

        if (!userResult || !userResult.recordset || userResult.recordset.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy tài khoản."
            });
        }

        const oldHighScore = Number(userResult.recordset[0].HighScore) || 0;

        // =====================================
        // 2. Chỉ cập nhật nếu điểm mới cao hơn
        // =====================================
        let newHighScore = oldHighScore;

        if (currentScore > oldHighScore) {
            newHighScore = currentScore;

            await sql.query`
                UPDATE Users
                SET HighScore = ${newHighScore}
                WHERE Username = ${username}
            `;

            console.log(
                `🏆 New HighScore: ${username} ${oldHighScore} -> ${newHighScore}`
            );
        } else {
            console.log(
                `ℹ️ Score không vượt HighScore: ${username} score=${currentScore}, highScore=${oldHighScore}`
            );
        }

        // =====================================
        // 3. Lưu lịch sử điểm vào Blob
        // =====================================
        const data = JSON.stringify({
            username: username,
            score: currentScore,
            highScore: newHighScore,
            savedAt: new Date().toISOString()
        });

        const blobName = `scores/${username}-${Date.now()}.json`;

        const blockBlobClient =
            containerClient.getBlockBlobClient(blobName);

        await blockBlobClient.upload(
            data,
            Buffer.byteLength(data),
            {
                blobHTTPHeaders: {
                    blobContentType: "application/json"
                }
            }
        );

        console.log(
            `✅ Score saved: ${username} - ${currentScore} | HighScore: ${newHighScore}`
        );

        // =====================================
        // 4. Trả HighScore về frontend
        // =====================================
        return res.json({
            success: true,
            message: "Đã lưu điểm.",
            score: currentScore,
            highScore: newHighScore
        });

    } catch (err) {
        console.error("❌ Save score error:", err);

        return res.status(500).json({
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
app.get("/test-blob", async (req, res) => {
    try {
        const blobName = `test/test-${Date.now()}.txt`;

        const blobClient =
            containerClient.getBlockBlobClient(blobName);

        const data = "Hello Azure Blob Storage!";

        await blobClient.upload(
            data,
            Buffer.byteLength(data),
            {
                blobHTTPHeaders: {
                    blobContentType: "text/plain"
                }
            }
        );

        res.json({
            success: true,
            message: "Blob hoạt động!",
            blob: blobName
        });

    } catch (err) {

        console.error("Blob test error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});