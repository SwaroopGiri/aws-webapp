const bodyParser = require('body-parser');
const { response } = require('express');
const express = require('express')
const mysql = require('mysql')
const app = express()
const appRoot = require('app-root-path');
const winston = require('winston');
const SDC = require('statsd-client');
require("dotenv").config();
const path = require('path');
//Set port on which App runs
const port = 8000
//Import bcrypt for hashing
const bcrypt = require('bcryptjs')
//Import sequelize ORM
const {Sequelize, DataTypes} = require("sequelize");
//Import AWS SDK
const AWS = require('aws-sdk');
//Import Multer API to upload files
const multer = require("multer")
const multerS3 = require("multer-s3");
const { DynamoDB } = require('aws-sdk');
//Set bucket name from env
const bucketName = process.env.bucket;
// Create SDC object
const sdc = new SDC({host: "localhost",port: 8125});
var timer = new Date();
//Set Region
AWS.config.update({region: process.env.aws_region});

var sns = new AWS.SNS({});
var dynamoDatabase = new AWS.DynamoDB({});

// Create S3 service object
s3 = new AWS.S3();

const {
  v4: uuidv4
} = require('uuid');

//Create multer object 
const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: bucketName,
    key: function (req, file, cb) {
      console.log(file);
      cb(null, path.parse(file.originalname).name+'-'+Date.now().toString()+path.extname(file.originalname));
    },
  }),
});

//Call multer object into a variable
const Document = upload.single("file");

//Create Sequelize Connection to Database
const sequelize = new Sequelize(
  process.env.DB,
  process.env.SQL_ROOT,
  process.env.SQL_PASS,
    {
      host: process.env.RDS,
      port: '3306',
      dialect: 'mysql',
      pool: {
        max: 5,
        min: 0,
        idle: 10000
      },
   }
);

//Connect to DB
sequelize.authenticate().then(() => {
  console.log('Connection has been established successfully.');
}).catch((error) => {
  console.error('Unable to connect to the database: ', error);
});

//Create userTable Parameters
const userTable = sequelize.define("userTable", {
  id: {
    type: DataTypes.STRING,
    allowNull: false,
    primaryKey: true
  },
  Username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  Password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  First_Name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  Last_Name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isVerified: {
    type: DataTypes.STRING,
    allowNull: false
  },
  account_created: {
    type: DataTypes.DATE,
  },
  account_updated: {
    type: DataTypes.DATE,
  }
}, {
  timestamps: false,
  freezeTableName: true
});

//Create docTable Parameters
const docTable = sequelize.define("docTable", {
  doc_id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    allowNull: false,
    primaryKey: true,
    readOnly: true,
  },
  user_id: {
    type: DataTypes.STRING,
    allowNull: false,
    readOnly: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    readOnly: true,
  },
  date_created: {
    type: DataTypes.DATE,
    allowNull: false,
    readOnly: true,
  },
  s3_bucket_path: {
    type: DataTypes.STRING,
    readOnly: true,
  },
},
  {
    createdAt: "date_created",
    updatedAt: false,
    freezeTableName: true
});


//Create Table
sequelize.sync().then(() => {
  console.log('Users table created successfully!');
}).catch((error) => {
  console.error('Unable to create table : ', error);
});

app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

// define the custom settings for each transport (file, console)
var options = {
  file: {
    level: 'info',
    filename: `${appRoot}/logs/CSYE6225.log`,
    handleExceptions: true,
    json: true,
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    colorize: false,
  },
  console: {
    level: 'debug',
    handleExceptions: true,
    json: false,
    colorize: true,
  },
};

// instantiate a new Winston Logger with the settings defined above
var logger = new winston.createLogger({
  transports: [
    new winston.transports.File(options.file),
    new winston.transports.Console(options.console)
  ],
  exitOnError: false, // do not exit on handled exceptions
});

// create a stream object with a 'write' function that will be used by `morgan`
logger.stream = {
  write: function(message, encoding) {
    // use the 'info' log level so the output will be picked up by both transports (file and console)
    logger.info(message);
  },
};

module.exports = logger;

app.get('/healthz', (req, res) => {
  res.status(200).send("")
  sdc.timing('health.timeout', timer);
  logger.info("/health check successful");
  sdc.increment('endpoint.health');
})

app.get('/v1/account/:id', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];
  sdc.timing('health.timeout', timer);
  logger.info("/Get user details");
  sdc.increment('endpoint.health');
  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      checkPassFetch(user, pass, res);
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.post('/v2/account', (req, res) => {
  addRow(req.body, res);

  sdc.timing('health.timeout', timer);
  logger.info("/Create User");
  sdc.increment('endpoint.health');
})

app.post('/v1/documents', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];

  sdc.timing('health.timeout', timer);
  logger.info("/Insert Document");
  sdc.increment('endpoint.health');

  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
      let query = mysql.format(selectQuery,["Password","userTable","Username", user]);
      con.query(query, async (err, data) => {
        if (err) {
          console.error(err);
          res.status(400).json({message: err});
          return;
        }
        // Compare Password
        console.log(data);
        try{
          await bcrypt.compare(pass, data[0].Password).then(isMatch => {
            if (isMatch) {
              let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
              let query = mysql.format(selectQuery,["id","userTable","Username", user]);
              con.query(query, async (err, data) => {
                if (err) {
                  console.error(err);
                  res.status(400).json({message: err});
                  return;
                }
                Document(req, res, async (err) => {
                  if(err) {
                    console.log(err)
                    res.status(400).send("Bad Request in Document");
                  }
                  else{
                    try {
                      const document = await docTable.create({
                        user_id: data[0].id,
                        name: req.file.key,
                        s3_bucket_path: req.file.location,
                      });
                      res.status(201).send(document);
                    } catch (e) {
                      console.log(e);
                      return res.status(400).send("Bad Request in docTable");
                    }
                  }
                });
              })
            }
            else{
              return res.status(400).send({message: 'Invalid Password'});
            }
          })
        }catch(e){
          console.log(e);
          return res.status(400).send({message: 'Invalid Credentials'});
        }
      });
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.get('/v1/documents/:doc_id', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];

  sdc.timing('health.timeout', timer);
  logger.info("/Get Document by ID");
  sdc.increment('endpoint.health');

  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
      let query = mysql.format(selectQuery,["Password","userTable","Username", user]);
      con.query(query, async (err, data) => {
        if (err) {
          console.error(err);
          res.status(400).json({message: err});
          return;
        }
        // Compare Password
        console.log(data);
        try{
          await bcrypt.compare(pass, data[0].Password).then(async (isMatch) => {
            if (isMatch) {
              let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
              let query = mysql.format(selectQuery,["id","userTable","Username", user]);
              con.query(query, async (err, data) => {
                if (err) {
                  console.error(err);
                  res.status(400).json({message: err});
                  return;
                }
                const document = await docTable.findOne({
                  where: {
                    user_id: data[0].id,
                    doc_id: req.params.doc_id,
                  },
                });
                if (document) {
                  return res.status(200).send(document);
                  
                } else {
                  return res.status(404).json({message: "Object Not Found"});
                }
              })
            }
            else{
              return res.status(400).send({message: 'Invalid Password'});
            }
          })
        }catch(e){
          console.log(e);
          return res.status(400).send({message: 'Invalid Credentials'});
        }
      });
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.get('/v1/documents', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];

  sdc.timing('health.timeout', timer);
  logger.info("/Get All Documents for User");
  sdc.increment('endpoint.health');

  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
      let query = mysql.format(selectQuery,["Password","userTable","Username", user]);
      con.query(query, async (err, data) => {
        if (err) {
          console.error(err);
          res.status(400).json({message: err});
          return;
        }
        // Compare Password
        console.log(data);
        try{
          await bcrypt.compare(pass, data[0].Password).then(async (isMatch) => {
            if (isMatch) {
              let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
              let query = mysql.format(selectQuery,["id","userTable","Username", user]);
              con.query(query, async (err, data) => {
                if (err) {
                  console.error(err);
                  res.status(400).json({message: err});
                  return;
                }
                const document = await docTable.findAll({
                  where: {
                    user_id: data[0].id
                  },
                });
                if (document) {
                  return res.status(200).send(document);
                } else {
                  return res.status(404).json({message: "Object Not Found"});
                }
              })
            }
            else{
              return res.status(400).send({message: 'Invalid Password'});
            }
          })
        }catch(e){
          console.log(e);
          return res.status(400).send({message: 'Invalid Credentials'});
        }
      });
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.delete('/v1/documents/:doc_id', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];
  
  sdc.timing('health.timeout', timer);
  logger.info("/Delete Document by ID");
  sdc.increment('endpoint.health');

  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
      let query = mysql.format(selectQuery,["Password","userTable","Username", user]);
      con.query(query, async (err, data) => {
        if (err) {
          console.error(err);
          res.status(400).json({message: err});
          return;
        }
        // Compare Password
        console.log(data);
        try{
          await bcrypt.compare(pass, data[0].Password).then(async (isMatch) => {
            if (isMatch) {
              let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
              let query = mysql.format(selectQuery,["id","userTable","Username", user]);
              con.query(query, async (err, data) => {
                if (err) {
                  console.error(err);
                  res.status(400).json({message: err});
                  return;
                }
                const document = await docTable.findOne({
                  where: {
                    user_id: data[0].id,
                    doc_id: req.params.doc_id,
                  },
                });
                if (document) {
                  await s3.deleteObject({ Bucket: bucketName, Key: document.name }).promise();
                  const del = await docTable.destroy({
                    where: {
                      user_id: data[0].id,
                      doc_id: req.params.doc_id,
                    },
                  });
                  res.status(204).json({message: "Object Deleted"});
                  return;
                } else {
                  return res.status(404).json({message: "Object Not Found"});
                }
              })
            }
            else{
              return res.status(400).json({message: 'Invalid Password'});
            }
          })
        }catch(e){
          console.log(e);
          return res.status(400).json({message: 'Invalid Credentials'});
        }
      });
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.get('/v1/verifyUserEmail', (req, res) => {
  verifyUser(req, res);
})

app.put('/v1/account/:id', async (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];

  sdc.timing('health.timeout', timer);
  logger.info("/Update User");
  sdc.increment('endpoint.health');

  const User = await getUser(user);
  if(User){
    console.log('got user:', User.dataValues.Username);
    if (User.dataValues.isVerified === "true") {
      checkPassUpdate(user, pass, req.body, res)
    } else {
      return res.status(403).send({message: "Forbidden"});
    }
  } else {
    return res.status(400).send({message: 'User not found!'});
  }
})

app.delete('/v1/account/:id', (req, res) => {
  const authorization = req.headers.authorization;
  if(!authorization){
    return res.status(403).send({message: "Forbidden"});
  }

  var auth = new Buffer.from(authorization.split(' ')[1],'base64').toString().split(':');
  var user = auth[0];
  var pass = auth[1];
  checkPassDelete(user, pass, res)

  sdc.timing('health.timeout', timer);
  logger.info("/Delete User");
  sdc.increment('endpoint.health');
})

// Create Connection Pool
var con = mysql.createPool({
  host: process.env.RDS,
  port: "3306",
  user: process.env.SQL_ROOT,
  password: process.env.SQL_PASS,
  database: process.env.DB,
});

// Insert rows in the table
async function addRow(data, res) {
  if (Object.keys(data).length >= 4 && "Username" in data && "Password" in data && "First_Name" in data && "Last_Name" in data){
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    if (!emailRegex.test(data.Username)) {
        logger.info("/create user 400");
        res.status(400).send({message: 'Enter your Email ID in correct format.'});
        return;
    }
    const hash = await bcrypt.hash(data.Password, 10)
    let insertQuery = 'INSERT INTO ?? (??,??,??,??,??,??,??,??) VALUES (SUBSTR(MD5(RAND()), 1, 8),?,?,?,?,?,now(),now())';
    let query = mysql.format(insertQuery,["userTable","id","Username","Password","First_Name","Last_Name","isVerified","account_created","account_updated",data.Username,hash,data.First_Name,data.Last_Name,"false"]);
    con.query(query,(err, response) => {
      if(err) {
          console.error(err);
          res.status(400).send({message: "User already exists"})
          return;
      }
      // rows added
      console.log(response.insertId);
      let fetchQuery = 'SELECT ??, ??, ??, ??, ??, ??, ??  FROM ?? WHERE ?? = ?';
      let query2 = mysql.format(fetchQuery,["id","First_Name","Last_Name","Username","account_created","account_updated", "isVerified","userTable","Username", data.Username]);
      con.query(query2,(err, response) => {
        if(err) {
            console.error(err);
            res.status(400).send({message: "Couldn't fetch id"})
            return;
        }
        GenerateTokenDynaDB(data.Username);
        res.status(201).send(response[0])
      });
    });
  }
  else{
    return res.status(400).json({message: "Username ,Password, First_Name and Last_Name should be in payload"})
  }
}

//Generate token in dynamoDB for user verification
async function GenerateTokenDynaDB(Username){
  const randomID = uuidv4();
  const expiryTime = new Date().getTime();

  // Create the Service interface for dynamoDB
  var parameter = {
      TableName: 'CSYE6225DynamoDB',
      Item: {
          'Email': {
              S: Username
          },
          'Token': {
              S: randomID
          },
          'Expiry': {
              N: expiryTime.toString()
          }
      }
  };
  //saving the token onto the dynamo DB
  try {
      var dydb = await dynamoDatabase.putItem(parameter).promise();
      console.log('try dynamoDatabase', dydb);
  } catch (err) {
      console.log('err dynamoDatabase', err);
  }

  console.log('dynamoDatabase', dydb);
  var msg = {
      'Email': Username,
      'Token': randomID
  };
  console.log(JSON.stringify(msg));

  const params = {

      Message: JSON.stringify(msg),
      Subject: randomID,
      TopicArn: 'arn:aws:sns:us-east-1:798675619833:VerifyEmailCSYE6225'

  }
  var publishTextPromise = await sns.publish(params).promise();
  console.log('publishTextPromise', publishTextPromise);
}

// Verify User
async function verifyUser(req, res) {
  console.log('verifyUser :', req.query.email);
  const user = await getUser(req.query.email);
  if (user) {
      console.log('got user:', user.dataValues.Username);
      console.log('Current Verification Status:', user.dataValues.isVerified);
      if (user.dataValues.isVerified === "true") {
          res.status(202).send({message: 'Already Verified!'});
      } else {
          var params = {
              TableName: 'CSYE6225DynamoDB',
              Key: {
                  'Email': {
                      S: req.query.email
                  },
                  'Token': {
                      S: req.query.token
                  }
              }
          };
          console.log('got user param:');

          // Call DynamoDB to read the item from the table
          dynamoDatabase.getItem(params, function (err, data) {
              if (err) {
                  console.log("Error", err);
                  res.status(400).send({message: 'unable to verify'});
              } else {
                  console.log("Success dynamoDatabase getItem", data.Item);
                  try {
                      var ttl = data.Item.Expiry.N;
                      var curr = new Date().getTime();
                      console.log(ttl);
                      console.log('time difference', curr - ttl);
                      var time = (curr - ttl) / 60000;
                      console.log('time difference ', time);
                      if (time < 5) {
                          if (data.Item.Email.S == user.dataValues.Username) {
                              user.update({
                                  isVerified: "true"
                              }, {
                                  where: {
                                      id: user.dataValues.id
                                  }
                              }).then((result) => {
                                  if (result) {
                                      logger.info("update user 204");
                                      sdc.increment('endpoint.userUpdate');
                                      res.status(200).send({message: 'Successfully Verified!'});
                                  } else {
                                      res.status(400).send({message: 'unable to verify'});
                                  }
                              }).catch(err => {
                                  console.log("Error:", err);
                                  res.status(500).send({message: 'Error Updating the user'});
                              });
                          } else {
                              res.status(400).send({message: 'Token and email did not match'});
                          }
                      } else {
                          res.status(400).send({message: 'Token Expired! Cannot verify Email'});
                      }
                  } catch (err) {
                      console.log("Error:", err);
                      res.status(400).send({message: 'unable to verify'});
                  }
              }
          });
      }
  } else {
      res.status(400).send({
          message: 'User not found!'
      });
  }
}

async function getUser(username) {
  return userTable.findOne({
      where: {
          Username: username
      }
  });
}

// Check Password to fetch Details
function checkPassFetch(User, Pass, res) {
  let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
  let query = mysql.format(selectQuery,["Password","userTable","Username", User]);
  con.query(query, async (err, data) => {
    if (err) {
      console.error(err);
      res.status(400).json({message: err});
      return;
    }
    // Compare Password
    console.log(data);
    try{
      await bcrypt.compare(Pass, data[0].Password).then(isMatch => {
        if (isMatch) {
          queryRow(User, res);
        }
        else{
          return res.status(400).send({message: 'Invalid Password'});
        }
      })
    }catch(e){
      console.log(e);
      return res.status(400).send({message: 'Invalid Credentials'});
    }
  });
}

// Check Password to Update Details
function checkPassUpdate(User, Pass, Details, res) {
  let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
  let query = mysql.format(selectQuery,["Password","userTable","Username", User]);
  con.query(query, async (err, data) => {
    if (err) {
      console.error(err);
      res.status(400).json({message: err});
      return;
    }
    // Compare Password
    console.log(data);
    try{
      await bcrypt.compare(Pass, data[0].Password).then(isMatch => {
        if (isMatch) {
          updateRow(User, Details, res);
        }
        else{
          return res.status(400).json({message: 'Invalid Password'});
        }
      })
    }catch(e){
      console.log(e);
      return res.status(400).json({message: 'Invalid Credentials'});
    }
  });
}

// Check Password to Delete Details
function checkPassDelete(User, Pass, res) {
  let selectQuery = 'SELECT ?? FROM ?? WHERE ?? = ?';
  let query = mysql.format(selectQuery,["Password","userTable","Username", User]);
  con.query(query, async (err, data) => {
    if (err) {
      console.error(err);
      res.status(400).json({message: err});
      return;
    }
    // Compare Password
    console.log(data);
    try{
      await bcrypt.compare(Pass, data[0].Password).then(isMatch => {
        if (isMatch) {
          deleteRow(User, res);
        }
        else{
          return res.status(400).json({message: 'Invalid Password'});
        }
      })
    }catch(e){
      console.log(e);
      return res.status(400).json({message: 'Invalid Credentials'});
    }
  });
}

// fetch rows from the table
function queryRow(user, res) {
  let selectQuery = 'SELECT ??, ??, ??, ??, ??, ??, ?? FROM ?? WHERE ?? = ?';    
  let query = mysql.format(selectQuery,["id","First_Name","Last_Name","Username","account_created","account_updated", "isVerified","userTable","Username", user]);
  con.query(query,(err, data) => {
      if(err) {
          console.error(err);
          res.status(400).json({message: err})
          return;
      }
      // rows fetch
      console.log(data);
      res.status(200).json(data[0])
  });
}

// update rows in table
 async function updateRow(User,data, res) {
  if ("Username" in data){
    if(User != data.Username){
      res.status(400).json({message: "Username can't be updated"})
      return;
    }
  }
  if (Object.keys(data).length >= 3 && "Password" in data && "First_Name" in data && "Last_Name" in data){
    let hash = await bcrypt.hash(data.Password, 10)
    let updateQuery = "UPDATE ?? SET ?? = ?, ?? = ?, ?? = ?, ?? = CURRENT_TIMESTAMP WHERE ?? = ?";
    let query = mysql.format(updateQuery,["userTable","First_Name",data.First_Name,"Last_Name",data.Last_Name,"Password",hash,"account_updated","Username",User]);
    con.query(query,(err, response) => {
        if(err) {
            console.error(err);
            res.status(400).json({message: err})
            return;
        }
        // rows updated
        console.log(response.affectedRows);
        if(response.affectedRows < 1){
          res.status(400).json({message: "User not found"})
          return;
        }
        res.status(200).json({message: "Updated User"})
    });
  }
  else{
    return res.status(400).json({message: "Password, First_Name and Last_Name should be in payload"})
  }
}

//delete rows from table
function deleteRow(User, res) {
  let deleteQuery = "DELETE from ?? where ?? = ?";
  let query = mysql.format(deleteQuery, ["userTable", "Username", User]);
  con.query(query,(err, response) => {
      if(err) {
          console.error(err);
          res.status(400).json({message: err})
          return;
      }
      // rows deleted
      console.log(response.affectedRows);
      if(response.affectedRows < 1){
        res.status(400).json({message: "User not found"})
        return;
      }
      res.status(200).json({message: "Deleted User"})
  });
}

//Server Setup
app.listen(port, () => {
  console.log(`App listening on port ${port}`)
})