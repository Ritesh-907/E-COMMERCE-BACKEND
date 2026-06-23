const express = require("express");
const usersRouter = require("./router/users.router");
const productsRouter = require("./router/products.router");

const app = express();
app.use(express.json());
app.use("/api/v1/users", usersRouter);
app.use("/api/v1/products",productsRouter);

module.exports = app;
