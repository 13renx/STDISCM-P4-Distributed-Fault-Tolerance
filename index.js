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

// Distributed fault-tolerance subsystem (Person C - Lance)
// import databaseService from './server/db/databaseService.js';
// import { createHealthRouter } from './distributed/healthRouter.js';
// import { selfRole } from './distributed/config.js';

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
const LOGIN_PUBLIC_URL = process.env.LOGIN_PUBLIC_URL;
const LOGIN_API_URL = process.env.LOGIN_API_URL;
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
	secret: process.env.SESSION_SECRET,
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
  
// Health endpoints for failure detection (GET /health, /health/ready).
// The failure detector / monitor node probes /health to decide if this node is
// UP or DOWN; /health/ready reports 503 when the database node is unreachable.
// app.use(
// 	createHealthRouter({
// 		role: selfRole,
// 		dependencies: {
// 			db: async () => {
// 				const status = databaseService.getStatus();
// 				// Confirm liveness with an actual ping when the driver claims connected.
// 				if (status.connected) await databaseService.ping();
// 				return databaseService.getStatus();
// 			},
// 		},
// 	}),
// );

app.use('/', indexRouter);
app.use('/', productsRouter);
app.use('/', shippingRouter);
app.use('/', usersRouter);
app.use('/', ordersRouter);
app.use('/', usersRouter);
app.use('/', indexRouter);
app.use('/', cartRouter);
app.use('/', adminRouter);
app.use('/', profileRouter);
app.use('/login', (req, res) => {
	console.log('getLogin() called');
	res.redirect(`${LOGIN_PUBLIC_URL}/login`);
});
app.use('/api/logout', (req, res) => {
	console.log('logout() called');

	req.session.destroy((err) => {
		if(!err) {
			res.status(200).json({ message: 'Logout successful!' });
		} else {
			console.error(err);
			res.status(500).json({ error: error.message });
		}
	});
})

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
	console.log(`Main server running at http://localhost:${PORT}`);
});