const Product = require("../model/product.model");

exports.getAllProduct = (req, res, next) => {
  console.log(req.body)
  res.status(200).json({
    status: "success",
    data: {
      item: "ice-cream",
      price: "100",
    },
  });
};
exports.createProduct = async (req, res, next) => {
  // console.log(req.ip)  
  const newProduct = await Product.create(req.body);
  res.status(200).json({
    status: "success",
    data: newProduct,
  });
};
