db = db.getSiblingDB(process.env.MONGO_APP_DATABASE);
db.createUser({user: process.env.MONGO_APP_USERNAME, pwd: process.env.MONGO_APP_PASSWORD, roles: [{role: "readWrite", db: process.env.MONGO_APP_DATABASE}]});
