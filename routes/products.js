const express = require('express');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const router = express.Router();

// Lets our error handler catch problems from database requests.
const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function checkProductId(id) {
  if (!mongoose.isValidObjectId(id)) {
    const error = new Error('Invalid product ID');
    error.status = 400;
    throw error;
  }
}


router.post('/', asyncRoute(async (req, res) => {
  const product = await Product.create(req.body);
  res.status(201).json(product);
}));


router.get('/', asyncRoute(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(req.query.limit, 10) || 10)
  );

  const filter = {};

  if (req.query.category) {
    filter.category = new RegExp(`^${escapeRegex(req.query.category)}$`, 'i');
  }

  if (req.query.search) {
    const search = new RegExp(escapeRegex(req.query.search), 'i');
    filter.$or = [
      { name: search },
      { sku: search },
      { supplier: search }
    ];
  }

  if (req.query.minPrice !== undefined || req.query.maxPrice !== undefined) {
    filter.price = {};

    if (req.query.minPrice !== undefined) {
      filter.price.$gte = Number(req.query.minPrice);
    }

    if (req.query.maxPrice !== undefined) {
      filter.price.$lte = Number(req.query.maxPrice);
    }
  }

  const allowedSortFields = ['name', 'price', 'quantity', 'category', 'createdAt'];
  const sortBy = allowedSortFields.includes(req.query.sortBy)
    ? req.query.sortBy
    : 'createdAt';
  const sortOrder = req.query.order === 'asc' ? 1 : -1;

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(filter)
  ]);

  res.json({
    total,
    page,
    totalPages: Math.ceil(total / limit),
    count: products.length,
    products
  });
}));


router.get('/reports/low-stock', async (req, res, next) => {
  try {
    const products = await Product.find({ $expr: { $lte: ['$quantity', '$reorderLevel'] } }).sort('quantity');
    res.json({ success: true, count: products.length, data: products });
  } catch (err) { next(err); }
});

router.get('/reports/category-summary', async (req, res, next) => {
  try {
    const summary = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          totalProducts: { $sum: 1 },
          totalQuantity: { $sum: '$quantity' },
          totalValue: { $sum: { $multiply: ['$price', '$quantity'] } },
          averagePrice: { $avg: '$price' },
        },
      },
      { $sort: { totalValue: -1 } },
    ]);
    res.json({ success: true, data: summary });
  } catch (err) { next(err); }
});


router.get('/:id', asyncRoute(async (req, res) => {
  checkProductId(req.params.id);

  const product = await Product.findById(req.params.id);

  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  res.json(product);
}));


router.put('/:id', asyncRoute(async (req, res) => {
  checkProductId(req.params.id);

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true, runValidators: true }
  );

  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  res.json(product);
}));


router.patch('/:id/restock', async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount <= 0) { res.status(400); throw new Error('amount must be a positive integer'); }
    const product = await Product.findByIdAndUpdate(req.params.id, { $inc: { quantity: amount } }, { new: true });
    if (!product) { res.status(404); throw new Error('Product not found'); }
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
});

router.patch('/:id/sale', async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount <= 0) { res.status(400); throw new Error('amount must be a positive integer'); }
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, quantity: { $gte: amount } },
      { $inc: { quantity: -amount } },
      { new: true }
    );
    if (!product) { res.status(400); throw new Error('Product not found or insufficient stock'); }
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
});

router.delete('/:id', asyncRoute(async (req, res) => {
  checkProductId(req.params.id);

  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    return res.status(404).json({ message: 'Product not found' });
  }

  res.json({ message: 'Product deleted', id: product.id });
}));

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;