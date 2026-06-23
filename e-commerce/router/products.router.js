const express = require("express");
const router = express.Router();

const productsController = require("../controllers/products.controller");
router
  .route("/")
  .get(productsController.getAllProduct)
  .post(productsController.createProduct);

module.exports = router;
