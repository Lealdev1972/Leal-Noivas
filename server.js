/* ======================================================
   SERVER PREMIUM COMPLETO
====================================================== */

require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const session = require("express-session");
const bcrypt = require("bcrypt");
const path = require("path");
const helmet = require("helmet");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");

const app = express();

/* ======================================================
   UPLOADS
====================================================== */

const uploadDir =
path.join(__dirname, "public/uploads");

if (!fs.existsSync(uploadDir)) {

  fs.mkdirSync(uploadDir, {
    recursive: true
  });

}

/* ======================================================
   MULTER
====================================================== */

const storage = multer.diskStorage({

  destination: (req, file, cb) => {

    cb(null, uploadDir);

  },

  filename: (req, file, cb) => {

    const unique =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1E9);

    cb(
      null,
      unique +
      path.extname(file.originalname)
    );

  }

});

const upload = multer({ storage });

/* ======================================================
   CONFIG
====================================================== */

app.set("trust proxy", 1);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

app.use(express.urlencoded({
  extended: true
}));

/* ======================================================
   SESSION
====================================================== */

app.use(
  session({
    secret:
      process.env.SESSION_SECRET,

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge:
        1000 * 60 * 60 * 24
    }
  })
);

/* ======================================================
   STATIC
====================================================== */

app.use(express.static(
  path.join(__dirname, "public")
));

/* ======================================================
   MYSQL
====================================================== */

const db = mysql.createPool({

  host: process.env.DB_HOST,

  user: process.env.DB_USER,

  password: process.env.DB_PASSWORD,

  database: process.env.DB_NAME,

  port:
    process.env.DB_PORT || 3306,

  connectionLimit: 10,

  waitForConnections: true,

  queueLimit: 0

});

db.getConnection((err, conn) => {

  if (err) {

    console.error(err);

  } else {

    console.log(
      "MYSQL CONECTADO"
    );

    conn.release();

  }

});

/* ======================================================
   MIDDLEWARE
====================================================== */

function authRequired(
  req,
  res,
  next
) {

  if (!req.session.user) {

    return res.status(401).json({
      success: false
    });

  }

  next();

}

function adminRequired(
  req,
  res,
  next
) {

  if (
    !req.session.user ||
    req.session.user.role !== "admin"
  ) {

    return res.status(403).json({
      success: false
    });

  }

  next();

}

/* ======================================================
   LOGIN
====================================================== */

app.post("/login", async (req, res) => {

  try {

    const {
      email,
      password
    } = req.body;

    const [rows] =
      await db.promise().query(`
        SELECT *
        FROM users
        WHERE email = ?
        LIMIT 1
      `,[email]);

    if (!rows.length) {

      return res.json({
        success: false,
        message:
          "Usuário não encontrado"
      });

    }

    const user = rows[0];

    let valid = false;

    if (
      String(user.password)
      .startsWith("$2")
    ) {

      valid =
        await bcrypt.compare(
          password,
          user.password
        );

    } else {

      valid =
        password === user.password;

    }

    if (!valid) {

      return res.json({
        success: false,
        message: "Senha inválida"
      });

    }

    req.session.user = {

      id: user.id,
      name: user.name,
      email: user.email,
      role:
        user.role || "cliente"

    };

    res.json({
      success: true,
      role: user.role
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false
    });

  }

});

/* ======================================================
   SESSION
====================================================== */

app.get("/me", (req, res) => {

  res.json(
    req.session.user || null
  );

});

/* ======================================================
   LOGOUT
====================================================== */

app.get("/logout", (req, res) => {

  req.session.destroy(() => {

    res.clearCookie("connect.sid");

    res.redirect("/login.html");

  });

});

/* ======================================================
   PRODUTOS
====================================================== */

app.get("/products", async (req, res) => {

  try {

    const [rows] =
      await db.promise().query(`
        SELECT *
        FROM products
        ORDER BY id DESC
      `);

    res.json(rows);

  } catch (error) {

    console.error(error);

    res.json([]);

  }

});

/* ======================================================
   CADASTRAR PRODUTO
====================================================== */

app.post(
  "/admin/products",
  adminRequired,
  upload.single("image"),
  async (req, res) => {

    try {

      const {
        name,
        description,
        price,
        rental_price,
        stock
      } = req.body;

      let image_url = "";

      if (req.file) {

        image_url =
          "/uploads/" +
          req.file.filename;

      }

      await db.promise().query(`
        INSERT INTO products
        (
          name,
          description,
          price,
          rental_price,
          stock,
          image_url
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,[
        name,
        description,
        price,
        rental_price,
        stock,
        image_url
      ]);

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

/* ======================================================
   CART
====================================================== */

app.get(
  "/cart",
  authRequired,
  async (req, res) => {

    try {

      const userId =
        req.session.user.id;

      const [rows] =
        await db.promise().query(`
          SELECT
            c.id,
            c.product_id,
            c.quantity,
            c.action_type,

            p.name,
            p.description,
            p.image_url,
            p.stock,

            CASE
              WHEN c.action_type='rent'
              THEN p.rental_price
              ELSE p.price
            END AS price

          FROM cart_items c

          INNER JOIN products p
          ON p.id = c.product_id

          WHERE c.user_id = ?
        `,[userId]);

      res.json(rows);

    } catch (error) {

      console.error(error);

      res.json([]);

    }

  }
);

app.post(
  "/cart",
  authRequired,
  async (req, res) => {

    try {

      const userId =
        req.session.user.id;

      const {
        product_id,
        action_type
      } = req.body;

      const [products] =
        await db.promise().query(`
          SELECT *
          FROM products
          WHERE id = ?
          LIMIT 1
        `,[product_id]);

      if (!products.length) {

        return res.json({
          success: false,
          message:
            "Produto não encontrado"
        });

      }

      const product = products[0];

      if (
        Number(product.stock) <= 0
      ) {

        return res.json({
          success: false,
          message:
            "Sem estoque"
        });

      }

      const [exists] =
        await db.promise().query(`
          SELECT *
          FROM cart_items
          WHERE user_id = ?
          AND product_id = ?
          AND action_type = ?
          LIMIT 1
        `,[
          userId,
          product_id,
          action_type
        ]);

      if (exists.length) {

        const qtd =
          Number(
            exists[0].quantity
          ) + 1;

        if (
          qtd >
          Number(product.stock)
        ) {

          return res.json({
            success: false,
            message:
              "Estoque insuficiente"
          });

        }

        await db.promise().query(`
          UPDATE cart_items
          SET quantity = ?
          WHERE id = ?
        `,[
          qtd,
          exists[0].id
        ]);

      } else {

        await db.promise().query(`
          INSERT INTO cart_items
          (
            user_id,
            product_id,
            quantity,
            action_type
          )
          VALUES (?, ?, 1, ?)
        `,[
          userId,
          product_id,
          action_type
        ]);

      }

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

app.delete(
  "/cart/:id",
  authRequired,
  async (req, res) => {

    try {

      await db.promise().query(`
        DELETE FROM cart_items
        WHERE id = ?
      `,[req.params.id]);

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

/* ======================================================
   CHECKOUT
====================================================== */

app.post(
  "/checkout",
  authRequired,
  async (req, res) => {

    const conn =
      await db.promise().getConnection();

    try {

      await conn.beginTransaction();

      const userId =
        req.session.user.id;

      const [items] =
        await conn.query(`
          SELECT
            c.*,

            p.name,
            p.price,
            p.stock,
            p.rental_price

          FROM cart_items c

          INNER JOIN products p
          ON p.id = c.product_id

          WHERE c.user_id = ?
        `,[userId]);

      if (!items.length) {

        throw new Error(
          "Carrinho vazio"
        );

      }

      let total = 0;

      for (const item of items) {

        if (
          Number(item.quantity) >
          Number(item.stock)
        ) {

          throw new Error(
            "Estoque insuficiente para " +
            item.name
          );

        }

        const valor =
          item.action_type === "rent"
            ? Number(item.rental_price)
            : Number(item.price);

        total +=
          valor * item.quantity;

      }

      const [order] =
        await conn.query(`
          INSERT INTO orders
          (
            user_id,
            total,
            status
          )
          VALUES (?, ?, ?)
        `,[
          userId,
          total,
          "Pendente"
        ]);

      const orderId =
        order.insertId;

      for (const item of items) {

        const valor =
          item.action_type === "rent"
            ? Number(item.rental_price)
            : Number(item.price);

        await conn.query(`
          INSERT INTO order_items
          (
            order_id,
            product_id,
            quantity,
            unit_price,
            action_type
          )
          VALUES (?, ?, ?, ?, ?)
        `,[
          orderId,
          item.product_id,
          item.quantity,
          valor,
          item.action_type
        ]);

        await conn.query(`
          UPDATE products
          SET stock = stock - ?
          WHERE id = ?
        `,[
          item.quantity,
          item.product_id
        ]);

      }

      await conn.query(`
        DELETE FROM cart_items
        WHERE user_id = ?
      `,[userId]);

      await conn.commit();

      res.json({
        success: true,
        message:
          "Pedido finalizado"
      });

    } catch (error) {

      await conn.rollback();

      console.error(error);

      res.status(500).json({
        success: false,
        message: error.message
      });

    } finally {

      conn.release();

    }

  }
);

/* ======================================================
   ADMIN PEDIDOS
====================================================== */

app.get(
  "/admin/orders",
  adminRequired,
  async (req, res) => {

    try {

      const [rows] =
        await db.promise().query(`
          SELECT
            o.*,
            u.name,
            u.email

          FROM orders o

          LEFT JOIN users u
          ON u.id = o.user_id

          ORDER BY o.id DESC
        `);

      res.json(rows);

    } catch (error) {

      console.error(error);

      res.json([]);

    }

  }
);

/* ======================================================
   ITENS PEDIDO
====================================================== */

app.get(
  "/admin/order-items/:id",
  adminRequired,
  async (req, res) => {

    try {

      const orderId =
        req.params.id;

      const [rows] =
        await db.promise().query(`
          SELECT
            oi.*,

            p.name AS product_name,
            p.image_url

          FROM order_items oi

          LEFT JOIN products p
          ON p.id = oi.product_id

          WHERE oi.order_id = ?
        `,[orderId]);

      res.json(rows);

    } catch (error) {

      console.error(error);

      res.json([]);

    }

  }
);

/* ======================================================
   UPDATE STATUS PEDIDO
====================================================== */

app.put(
  "/admin/order/:id",
  adminRequired,
  async (req, res) => {

    try {

      const id =
        req.params.id;

      const {
        status
      } = req.body;

      await db.promise().query(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `,[
        status,
        id
      ]);

      res.json({
        success: true,
        message:
          "Status atualizado"
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        success: false
      });

    }

  }
);

/* ======================================================
   RENTALS
====================================================== */

app.get(
  "/admin/rentals",
  adminRequired,
  async (req, res) => {

    try {

      const [rows] =
        await db.promise().query(`
          SELECT *
          FROM rentals
          ORDER BY id DESC
        `);

      res.json(rows);

    } catch (error) {

      console.error(error);

      res.json([]);

    }

  }
);

/* ======================================================
   HOME
====================================================== */

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );

});

/* ======================================================
   START
====================================================== */

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`
==================================
SERVIDOR ONLINE
PORTA ${PORT}
==================================
  `);

});