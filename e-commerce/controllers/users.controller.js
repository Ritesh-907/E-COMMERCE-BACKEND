exports.getAllCustomer = (req, res, next) => {
  res.status(200).json({
    status: "success",
    data: {
      name: "Ritesh",
    },
  });
};
