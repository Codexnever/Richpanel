const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const app = express();
const port = 8080;
const hbs = require('hbs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient } = require('mongodb');
const axios = require('axios');
const passport = require('passport');
const { access } = require('fs');
const FacebookStrategy = require('passport-facebook').Strategy;

const partialsPath = path.join(__dirname, './views/partials');
const viewsPath = path.join(__dirname, './views');

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true
}));
app.use('/public/script', express.static('public/script', { 'Content-Type': 'application/javascript' }));
app.use('/public/css', express.static('public/css', { 'Content-Type': 'text/css' }));
app.use(express.static('public'));
app.set('view engine', 'hbs');
app.set('views', viewsPath);
hbs.registerPartials(partialsPath);

// Connect to MongoDB
const uri = 'mongodb://localhost:27017';
const client = new MongoClient(uri, { useNewUrlParser: true });

// Passport.js setup
passport.use(new FacebookStrategy({
  clientID: '775399240650444',
  clientSecret: '13389acda3041b9281314c551050a7b4',
  callbackURL: 'http://localhost:8080/auth/facebook/callback',
  profileFields: ['id', 'displayName', 'email']
}, (accessToken, refreshToken, profile, done) => {
  // Set the access token in req.user
  const user = {
    profile,
    accessToken
  };
  return done(null, user);
}));


passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

// Endpoint to initiate Facebook OAuth flow
app.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

// Callback endpoint to handle OAuth callback from Facebook
app.get('/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/Sign-in' }),
  (req, res) => {
    const accessToken = req.user.accessToken;
    console.log('Access token', accessToken)
    const integratedPageName = req.user.displayName;

    res.redirect(`/logout?integratedPageName=${integratedPageName}`);
  });

app.get('/logout', (req, res) => {
  const integratedPageName = req.query.integratedPageName;
  res.render('disconnect', { integratedPageName });
});
app.post('/disconnect/facebook', isAuthenticated, (req, res) => {
  const integratedPageName = req.user.displayName;
  res.redirect(`/Sign-in?integratedPageName=${integratedPageName}`); // Redirect to the sign-in page with integratedPageName as a query parameter
});
// Middleware to check authentication status
function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// Routes
app.get('/integration', isAuthenticated, (req, res) => {
  res.render('connect', { connectedAccountName: req.user.connectedAccountName });
});


app.get('/Dashboard', isAuthenticated, async (req, res) => {
  try {
    // Ensure req.user contains the accessToken
    const accessToken = req.user.accessToken;
    console.log('final access', accessToken);


    if (!accessToken) {
      throw new Error('Access token not found');
    }
    // Make a Graph API request to fetch conversations
    const response = await axios.get('https://graph.facebook.com/me/conversations', {
      params: {
        access_token: accessToken,
        fields: 'id,participants,messages'
      }
    });

    // Extract conversation data from the API response
    const conversations = response.data.data;

    // Pass conversation data to the landing page template
    res.render('landing', { conversations });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Error fetching conversations');
  }
});

app.get('/', async (req, res) => {
  res.render('Sign-up');
});

app.get('/Sign-in', async (req, res) => {
  res.render('Sign-in');
});

app.post('/signin', async (req, res) => {
  try {
    await client.connect();
    const database = client.db('Richpanel');
    const collection = database.collection('signup');
    const { sigusername, sigpassword } = req.body;
    // Find user info based on username
    const user = await collection.findOne({ username: sigusername });
    if (!user) {
      // If user not found
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }
    // Verify the password
    const isPasswordValid = await bcrypt.compare(sigpassword, user.password);
    if (!isPasswordValid) {
      // If password is invalid
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    // Generate JWT token
    const token = jwt.sign({ username: user.username }, 'secret_key');

    // Calculate the expiration date for the cookie (15 seconds from now)
    const expirationDate = new Date();
    expirationDate.setSeconds(expirationDate.getSeconds() + 15); 

    // Set the cookie with the expiration date
    res.cookie('token', token, {
      httpOnly: true,
      expires: expirationDate // Set the expiration date
    });

    res.render('connect')
  } catch (error) {
    console.error('Error during sign-in:', error);
    res.status(500).json({ success: false, message: 'An error occurred during sign-in' });
  } finally {
    await client.close();
  }
});

//Messenger
// Route to fetch and print all messages

app.post('/Signup', async (req, res) => {
  let client; // Declare client variable outside the try-catch block

  try {
    // Connect to the MongoDB server
    client = new MongoClient(uri, { useNewUrlParser: true });
    await client.connect();

    const { username, email, password } = req.body;

    const userId = generateUserId();

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Access the database and collection
    const database = client.db('Richpanel');
    const collection = database.collection('signup');

    // Insert user data into the collection
    await collection.insertOne({
      userId: userId,
      username: username,
      email: email,
      password: hashedPassword
    });

    // Generate JWT token
    const token = jwt.sign({ userId: userId }, '123456 789m,,m456123m');

    // Send response with token
    res.status(200).json({ success: true, token });
  } catch (error) {
    console.error('Error during signup:', error);
    res.status(500).json({ success: false, message: 'An error occurred during signup' });
  } finally {
    // Close the MongoDB client connection
    if (client) {
      await client.close();
    }
  }
});

app.listen(port, () => {
  console.log(`Express app listening on port ${port}`);
});

function generateUserId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
