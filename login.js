// Dependencies
import session from 'express-session';
import MongoStore from 'connect-mongo';	
import exphbs from 'express-handlebars';
import express from 'express';
import dotenv from 'dotenv';
import Handlebars from 'handlebars';
import helmet from 'helmet';

// Database connection
import connectDB from './server/DbConnect.js';

// Routers
import indexRouter from './server/api/index.js';
import signupRouter from './server/api/signup.js';
import productsRouter from './server/api/products.js';
import shippingRouter from './server/api/shipping.js';
import usersRouter from './server/api/users.js';
import ordersRouter from './server/api/orders.js';
import loginRouter from './server/api/login.js';
import cartRouter from './server/api/cart.js'
import adminRouter from './server/api/admin.js'
import profileRouter from './server/api/profile.js'

const app = express();
const PORT = process.env.PORT;
const MAIN_URL = process.env.MAIN_URL;
dotenv.config();
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
	store: MongoStore.create({
		mongoUrl: process.env.MONGODB_URI, // your existing db node
		collectionName: 'sessions',
		ttl: 60 * 60 * 24 // 1 day in seconds
	}),
	secret: process.env.SECRET_SESSION,
	resave: false,
	saveUninitialized: false,
	cookie: { secure: false }
}));
app.engine('.hbs', exphbs.engine({ extname: '.hbs', defaultLayout: 'main', runtimeOptions: {allowProtoPropertiesByDefault: true} }));
app.set('view engine', '.hbs');
// app.use(
//   helmet({
//     contentSecurityPolicy: {
//       directives: {
//         "default-src": ["'self'"],
//         "script-src": ["'self'", "ajax.googleapis.com"],
//         "img-src": ["'self'", "via.placeholder.com"]
//       },
//     },
//   })
// );
Handlebars.registerHelper('eq', function (a, b) {
	return a === b;
  });
  
app.use('/', usersRouter);
app.use('/', signupRouter);
app.use('/', loginRouter);
app.use('/', (req, res) => {
	console.log('getIndex() called');
	res.redirect(`${MAIN_URL}`);
});

/**
 * Middleware function to handle 404 errors.
 * Renders a custom error page when a requested route is not found.
 *
 * @param {Object} req - The request object.
 * @param {Object} res - The response object.
 * @returns {void}
 */
app.use((req, res) => {
	if(req.body.stat && req.body.title && req.body.title) {
		const { stat, title, body } = req.body;
		res.status(stat).render('handling', { title, body });
	} else {
		res.status(404).render('handling', { title: 'Page Not Found', body: 'Error 404. Page not found.' });
	}
});

app.listen(PORT, () => {
	console.log(`Server running at http://localhost:${PORT}`);
});