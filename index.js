const express = require('express')
const app = express()
require('dotenv').config()
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const nodemailer = require("nodemailer");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 8000

// middleware
const corsOptions = {
  origin: [
    'http://localhost:5173',
     'http://localhost:5174',
     "https://stay-vista-c7f33.web.app",
     "https://stay-vista-c7f33.firebaseapp.com"
],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token
  console.log(token)
  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.qrif73o.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {

    const roomsCollection = client.db('stayvista').collection('rooms');
    const usersCollection = client.db("stayvista").collection('users');
    const bookingsCollection = client.db("stayvista").collection('bookings');

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "admin") {
        return res.status(401).send({ message: 'unauthorized access!' })
      }
      next();
    }
    // verify host 
    const verifyHost = async (req, res, next) => {
      const user = req.user;
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      if (!result || result?.role !== "host") {
        return res.status(401).send({ message: 'unauthorized access!' })
      }
      next();
    }
    // auth related api
    app.post('/jwt', async (req, res) => {
      const user = req.body
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })
    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
        console.log('Logout successful')
      } catch (err) {
        res.status(500).send(err)
      }
    })


    // save a user data 
    app.put('/user', async (req, res) => {
      const user = req.body;
      const query = { email: user?.email }
      // if user allready exists 
      const isExist = await usersCollection.findOne({ email: user?.email })
      if (isExist) {
        // if user try to change role
        if (user.status === "Requested") {
          const result = await usersCollection.updateOne(query, {
            $set: {
              status: user?.status
            },
          })
          return res.send(result)
        } else {
          // if user login again
          return res.send(isExist);
        }
      }

      // save the user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),

        }
      }
      const result = await usersCollection.updateOne(query, updateDoc, options);
         // send email to new user
         sendEmail(user?.email, {
          subject: 'Welcome to StayVista!',
          message: `Hope you will find you destination`,
        })
      res.send(result)
    })


    // send email
    const sendEmail = async (emailAdress, emailData) => {
      service: "gmail"
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // true for port 465, false for other ports
        auth: {
          user: process.env.TRANSPOTER_EMAIL,
          pass: process.env.TRANSPOTER_PASS,
        },
      });

      // verify connection configuration
      transporter.verify(function (error, success) {
        if (error) {
          console.log(error);
        } else {
          console.log("Server is ready to take our messages");
        }
      });

      const mail = {
        from: `"Stay-vista" <${process.env.TRANSPOTER_EMAIL}>`, // sender address
        to: emailAdress, // list of receivers
        subject: emailData.subject, // Subject line
        html: emailData.message
      }
      transporter.sendMail(mail, (error, info) => {
        if (error) {
          console.log(error);
        } else {
          console.log('Email Sent : ' + info.response);
        }
      });


    }

    // get a user info by email for role
    app.get('/user/:email', async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result)
    })

    // update a user role
    app.patch('/users/update/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: { ...user, timestamp: Date.now() }
      }
      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result)

    })

    // Get all users data
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })
    // Get all Rooms from db
    app.get('/rooms', async (req, res) => {
      const category = req.query.category;
      let query = {}
      if (category && category !== "null") query = { category }
      const result = await roomsCollection.find(query).toArray()
      res.send(result)
    });

    // Get a single room data from db using id
    app.get('/room/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await roomsCollection.findOne(query)
      res.send(result)
    });



    // save a room data in db
    app.post('/add-room', verifyToken, verifyHost, async (req, res) => {
      const roomData = req.body;
      const result = await roomsCollection.insertOne(roomData)
      res.send(result)

    })
    // Update room  data in db
    app.put('/room/update/:id', verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const roomData = req.body;
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: roomData,
      }
      const result = await roomsCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // get all rooms from host
    app.get('/my-list/:email', verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      let query = { "host.email": email }
      const result = await roomsCollection.find(query).toArray()
      res.send(result)
    });

    // Delete a room
    app.delete('/room/:id', verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await roomsCollection.deleteOne(query);
      res.send(result)
    });


    // create payment intent
    app.post('/create-payment-intent', verifyToken, async (req, res) => {
      const price = req.body.price;
      const priceInCent = parseFloat(price) * 100
      if (!price || priceInCent < 1) {
        return res.status(400).send({ error: "Invalid price" });
      }

      // generate client secret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: priceInCent,
        currency: "usd",
        automatic_payment_methods: {
          enabled: true,
        },
      })
      // send client secret as response
      res.send({ clientSecret: client_secret })
    })


    // save a bookings data in db
    app.post('/booking', verifyToken, async (req, res) => {
      const bookingData = req.body;
      // save room booking
      const result = await bookingsCollection.insertOne(bookingData);
      // send email to guest
      sendEmail(bookingData?.guest?.email, {
        subject: "Booking successfully! ",
        message: `You've successfully booked a room through StayVista. Transaction Id: ${bookingData.transactionId}`
      });
      // send email to guest

      sendEmail(bookingData?.host?.email, {
        subject: "Your room got booked!",
        message:  `Get ready to welcome ${bookingData.guest.name}.`
      })

      res.send(result)

    })

    // update room status
    app.patch('/room/status/:id', async (req, res) => {
      const id = req.params.id;
      const status = req.body.status
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { booked: status }
      }
      const result = await roomsCollection.updateOne(query, updateDoc)
      res.send(result)

    })

    // get all bookings for a host
    app.get("/manage-bookings/:email", verifyToken, verifyHost, async (req, res) => {
      const email = req.params.email;
      const query = { "host.email": email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result);
    });
    // get all bookings for a guest
    app.get("/my-bookings/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { "guest.email": email }
      const result = await bookingsCollection.find(query).toArray()
      res.send(result);
    });

    // Cancel a booking data 
    app.delete('/booking/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingsCollection.deleteOne(query);
      res.send(result)
    });

    // admin statistices
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const bookingsDetails = await bookingsCollection.find({}, {
        projection: {
          date: 1,
          price: 1
        }
      }).toArray()

      const totalRooms = await roomsCollection.countDocuments()
      const totalUsers = await usersCollection.countDocuments()
      const totalPrice = bookingsDetails.reduce((sum, booking) => sum + booking.price, 0)


      const chartData = bookingsDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })

      chartData.unshift(["Day", "Sales"])

      res.send({
        totalRooms,
        totalUsers,
        totalBookings: bookingsDetails?.length,
        totalPrice,
        chartData
      })
    })
    // host statistices
    app.get('/host-stat', verifyToken, verifyHost, async (req, res) => {
      const { email } = req.user
      const bookingsDetails = await bookingsCollection.find({ "host.email": email }, {
        projection: {
          date: 1,
          price: 1
        }
      }).toArray()
      const { timestamp } = await usersCollection.findOne({ email }, { projection: { timestamp: 1 } })
      const totalRooms = await roomsCollection.countDocuments({ "host.email": email })
      const totalPrice = bookingsDetails.reduce((sum, booking) => sum + booking.price, 0)

      const chartData = bookingsDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })

      chartData.unshift(["Day", "Sales"])

      res.send({
        totalRooms,
        totalBookings: bookingsDetails?.length,
        totalPrice,
        chartData,
        hostSince: timestamp
      })
    })
    // guest statistices
    app.get('/guest-stat', verifyToken, async (req, res) => {
      const { email } = req.user
      const bookingsDetails = await bookingsCollection.find({ "guest.email": email }, {
        projection: {
          date: 1,
          price: 1
        }
      }).toArray()
      const { timestamp } = await usersCollection.findOne({ email }, { projection: { timestamp: 1 } })
      const totalPrice = bookingsDetails.reduce((sum, booking) => sum + booking.price, 0)

      const chartData = bookingsDetails.map(booking => {
        const day = new Date(booking.date).getDate()
        const month = new Date(booking.date).getMonth() + 1
        const data = [`${day}/${month}`, booking?.price]
        return data
      })

      chartData.unshift(["Day", "Sales"])

      res.send({
        totalBookings: bookingsDetails?.length,
        totalPrice,
        chartData,
        guestSince: timestamp
      })
    })


    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 })
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!'
    // )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from StayVista Server..')
})

app.listen(port, () => {
  console.log(`StayVista is running on port ${port}`)
})
