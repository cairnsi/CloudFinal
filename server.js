const express = require('express');
const app = express();
var handlebars = require('express-handlebars').create({defaultLayout:'main'});
const path = require(`path`);
const bodyParser = require('body-parser');
const {Datastore} = require('@google-cloud/datastore');
const datastore = new Datastore();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));
app.engine('handlebars', handlebars.engine);
app.set('view engine', 'handlebars');
app.enable('trust proxy');
var request = require('request');

const jwt = require('express-jwt');
const jwksRsa = require('jwks-rsa');
const {OAuth2Client} = require('google-auth-library');
const client = new OAuth2Client(client_id);

var redirect_uri= "http://localhost:8080/oauth";//"https://assignment6-312700.wn.r.appspot.com/oauth";
var client_id = "916034912784-vmi2ekt46gp1bac0svv4t3acj2rnn8oj.apps.googleusercontent.com";
var scope = "https://www.googleapis.com/auth/userinfo.profile";
client_secret = "81GIJ6ztg99K7LzYAsaX_nxo";
const STATE_Key= "STATE";

const BOAT = "boat"
const LOAD = "load"
const USER = "USER"
var address = "";
let date= new Date();

async function checkState(state){
	const q = datastore.createQuery(STATE_Key);
	entities = await datastore.runQuery(q);
	states = entities[0];
	states = states.map(fromDatastore);
	foundState = false;
	id = null;
	states.forEach(function(ele) {
		if(ele.state == state){
			foundName = true;
			id = ele.id;
		}
	});
	if(foundName){
		const key = datastore.key([STATE_Key, parseInt(id,10)]);
		var [ele] = await datastore.get(key);
		await datastore.delete(key);
	}
	return foundName;
	
}

/*-------------- Auth Routes  -------------------------*/
app.get('/',function(req,res){
  var context = {};
   res.render('Home',context);
});

app.get('/oauth',function(req,res){
  if(!checkState(req.query.state)){
		error = {"Error": "The state value was not correct. "}
		res.status(400).send(error);
		return;
  }
   var context = {};
   
   var body = 'code=' + req.query.code +'&client_id=' + client_id + '&client_secret=' + client_secret + '&redirect_uri=' + redirect_uri + '&grant_type=authorization_code';
  
  request.post({
  headers: {'content-type' : 'application/x-www-form-urlencoded'},
  url:     'https://oauth2.googleapis.com/token',
  body:    body
	}, function(error, response, body){
	  var obj = JSON.parse(body);
	  var JWTtoken = obj.id_token;
	  var token = 'Bearer ' + obj.access_token;
	  request.get({
	  headers: {'Authorization': token},
	  url:     'https://people.googleapis.com/v1/people/me?personFields=names',
	  body: ""
		}, function(error, response, body){
			
		    var obj = JSON.parse(body);
			context.firstName = obj.names[0].givenName;
			context.lastName = obj.names[0].familyName;
			context.id_token = JWTtoken;
			idToken = JWTtoken.replace('Bearer ','');
			client.verifyIdToken({idToken,client_id}).then( ticket => {
			const payload = ticket.getPayload();
			userid = payload['sub'];
			const key = datastore.key([USER, parseInt(userid,10)]);
			get_User(key).then(user => {
			if(user ==null){
				const new_User = {"firstName": obj.names[0].givenName, "lastName": obj.names[0].familyName};
				datastore.save({"key":key, "data":new_User}).then(() => {res.render('Shred',context);});
			}else{
				res.render('Shred',context);
			}
			});
			});
		});
	});
	
});

app.post('/Authenticate', async function(req,res){
	
	var state = "state" + Math.floor(Math.random() * 1000000); 
	var key = datastore.key(STATE_Key);
	const new_State = {"state": state};
	await datastore.save({"key":key, "data":new_State});
	
   res.writeHead(301,
  {Location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + client_id + '&scope=' + scope + '&redirect_uri=' + redirect_uri + '&state=' + state + '&response_type=code'}
);
res.end();
});



/*-------------- Auth Routes  -------------------------*/

function fromDatastore(item){
    item.id = item[Datastore.KEY].id;
    return item;
	
}

/*-------------- User Functions ----------------*/
async function get_User(key){
	var [user] = await datastore.get(key);
	if(user == null){
		return null;
	}
	user.id = user.id;
	return user;
}

function get_Users(){
    var q = datastore.createQuery(USER);
    const results = {};
	return datastore.runQuery(q).then( (entities) => {
            results.items = entities[0].map(fromDatastore);
			return results;
		});
}

/*-------------- end User ---------------------*/

/* ------------- Begin Boat Model Functions ------------- */
function post_Boat(departureLocation, destination, capacity){
    var key = datastore.key(BOAT);
	const new_Boat = {"departureLocation": departureLocation, "destination": destination, "capacity": capacity, "loads": new Array()};
	return datastore.save({"key":key, "data":new_Boat}).then(() => {return key});
}

async function get_Boat(key){
	var [boat] = await datastore.get(key);
	if(boat == null){
		return null;
	}
	boat.id = key.id;
	boat = boatSelf(boat);
	boat = boat_loadSelf(boat);
	return boat;
}

function get_Boats(req){
	var qq = datastore.createQuery(BOAT);
	return datastore.runQuery(qq).then( (boats) => {
    var q = datastore.createQuery(BOAT).limit(5);
    const results = {};
    if(Object.keys(req.query).includes("cursor")){
        q = q.start(req.query.cursor);
    }
	return datastore.runQuery(q).then( (entities) => {
            results.items = entities[0].map(fromDatastore);
			results.items = results.items.map(boatSelf);
			results.items = results.items.map(boat_loadSelf);
            if(entities[1].moreResults !== datastore.NO_MORE_RESULTS ){
                results.next = req.protocol + "://" + req.get("host") + "/boats" + "?cursor=" + entities[1].endCursor;
            }
			results.totalItems = boats[0].length;
			return results;
		});
	});
}

async function delete_Boat(id){
    const key = datastore.key([BOAT, parseInt(id,10)]);
	var [boat] = await datastore.get(key);
	//empty loads
	
	boat.loads.forEach(async function(loadobj) {
		const loadKey = datastore.key([LOAD, parseInt(loadobj.id,10)]);
		var [load] = await datastore.get(loadKey);
		load.carrier = null;
		await datastore.update({"key":loadKey, "data":load});
	})
	
	//done empty
    return datastore.delete(key);
}

async function update_Boat(id,departureLocation, destination, capacity){
    const key = datastore.key([BOAT, parseInt(id,10)]);
	boat = await get_Boat(key);
	if(departureLocation){
		boat.departureLocation = departureLocation;
	}
	if(destination){
		boat.destination = destination;
	}
	if(capacity){
		boat.capacity = capacity;
	}
	
	return datastore.update({"key":key, "data":boat}).then(() => {return key});
}

function boatSelf(item){
	 item.self = address +"/boats/" + item.id;
	 return item;
}

function boat_loadSelf(item){
	item.loads.forEach( function(load){
		load.self = address +"/loads/" + load.id;
		
	});
	 return item;
}

async function boat_removeLoad(id,boatKey){
	var [boat] = await datastore.get(boatKey);
	var index =-1;
	var i;
	for (i = 0; i < boat.loads.length; i++) {
		if(boat.loads[i].id == id){
			index = i;
		}
	}
	if(index>-1){
		boat.loads.splice(index,1);
	}
	datastore.save({"key":boatKey, "data":boat});
}

async function getBoatUsedCapacity(boat){
	var capacityTaken = 0;
	for(i=0;i < boat.loads.length; i++){
		const key = datastore.key([LOAD, parseInt(boat.loads[i].id,10)]);
		load = await get_Load(key);
		capacityTaken = capacityTaken + load.volume;
	}
	return capacityTaken;
}

/* ------------- End Boat Model Functions ------------- */

/* ------------- Begin load Model Functions ------------- */
function post_Load(req, owner){
    var key = datastore.key(LOAD);
	const new_Load = {"volume": req.body.volume, "content": req.body.content, "carrier": null, "owner": owner, "fragile" : req.body.fragile};
	return datastore.save({"key":key, "data":new_Load}).then(() => {return key});
}

async function get_Load(key){
	var [load] = await datastore.get(key);
	if(load == null){
		return null;
	}
	load.id = key.id;
	load = loadSelf(load);
	load = load_boatSelf(load);
	return load;
}

function loadSelf(item){
	 item.self = address +"/loads/" + item.id;
	 return item;
}
function load_boatSelf(item){
	if(item.carrier == null){
		return item;
	}
	 item.carrier.self = address +"/boats/" + item.carrier.id;
	 return item;
}

function get_Loads(userId, req){
	var qq = datastore.createQuery(LOAD).filter('owner', '=', userId);
	return datastore.runQuery(qq).then( (loads) => {
    var q = datastore.createQuery(LOAD).filter('owner', '=', userId).limit(5);
    const results = {};
    if(Object.keys(req.query).includes("cursor")){
        q = q.start(req.query.cursor);
    }
	return datastore.runQuery(q).then( (entities) => {
            results.items = entities[0].map(fromDatastore);
			results.items = results.items.map(loadSelf);
			results.items = results.items.map(load_boatSelf);
            if(entities[1].moreResults !== datastore.NO_MORE_RESULTS ){
                results.next = req.protocol + "://" + req.get("host") + "/loads" + "?cursor=" + entities[1].endCursor;
            }
			results.totalItems = loads[0].length;
			return results;
		});
	});
}

async function delete_Load(id){
    const key = datastore.key([LOAD, parseInt(id,10)]);
	//remove load from boat
	
	var [load] = await datastore.get(key);
	if(load.carrier != null){
		const boatKey = datastore.key([BOAT, parseInt(load.carrier.id,10)]);
		var [boat] = await datastore.get(boatKey);
		var index =-1;
		var i;
		for (i = 0; i < boat.loads.length; i++) {
			if(boat.loads[i].id == id){
				index = i;
			}
		}
		if(index>-1){
			boat.loads.splice(index,1);
		}
		datastore.save({"key":boatKey, "data":boat});
		
	}
	
	// done remove
    return datastore.delete(key);
}

async function update_Load(id,volume, content, fragile){
    const key = datastore.key([LOAD, parseInt(id,10)]);
	load = await get_Load(key);
	if(volume){
		load.volume = volume;
	}
	if(content){
		load.content = content;
	}
	if(fragile != undefined){
		load.fragile = fragile;
	}
	return datastore.update({"key":key, "data":load}).then(() => {return key});
}


/* ------------- End load Model Functions ------------- */



/* ------------- Boat Routes -------------------------- */
app.get('/boats', async (req, res) => {
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	var boats = get_Boats(req)
	.then( (boats) => {
        res.status(200).json(boats);
    });
});



app.post('/boats', async (req, res) => {
	contentType = req.header('Content-type');
	if(contentType != "application/json"){
		error = {"Error": "only json accepted"}
		res.status(415).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.departureLocation || !req.body.destination || !req.body.capacity){
		error = {"Error": "The request object is missing at least one of the required attributes"}
		res.status(400).send(error);
		return;
	}
	else{
	post_Boat(req.body.departureLocation, req.body.destination, req.body.capacity)
    .then( key => {get_Boat(key).then(data => {res.status(201).send(data)});
		});
	}
});

app.delete('/boats/:id', async (req, res) => {
	address = req.protocol + "://" + req.get("host");
	const key = datastore.key([BOAT, parseInt(req.params.id,10)]);
	boat = await get_Boat(key);
	if(boat == null){
		error = {"Error": "No boat with this boat_id exists"  }
		res.status(404).send(error);
		return;
	}
	else{
		delete_Boat(req.params.id).then(res.status(204).end());
	}
});

app.patch('/boats/:id', async (req, res) => {
	contentType = req.header('Content-type');
	if(contentType != "application/json"){
		error = {"Error": "only json accepted"}
		res.status(415).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.departureLocation && !req.body.destination && !req.body.capacity){
		error = {"Error": "The request object is missing at least one of the required attributes"}
		res.status(400).send(error);
		return;
	}
	
	const key = datastore.key([BOAT, parseInt(req.params.id,10)]);
		boat = await get_Boat(key);
	
	
	if(boat == null){
		error = {"Error": "No boat with this boat_id exists"}
		res.status(404).send(error);
		return;
	}
	var boatCapacityTaken = await getBoatUsedCapacity(boat);
	if(req.body.capacity){
		if(boatCapacityTaken> req.body.capacity){
			error = {"Error": "Too much cargo on this boat to set the capacity this low"}
			res.status(400).send(error);
			return;
		}
	}
	
	update_Boat(req.params.id,req.body.departureLocation, req.body.destination, req.body.capacity).then(key => {get_Boat(key).then(data => {res.status(200).send(data)});
		});
	
	
});

app.put('/boats/:id', async (req, res) => {
	contentType = req.header('Content-type');
	if(contentType != "application/json"){
		error = {"Error": "only json accepted"}
		res.status(415).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.departureLocation || !req.body.destination || !req.body.capacity){
		error = {"Error": "The request object is missing at least one of the required attributes"}
		res.status(400).send(error);
		return;
	}
	const key = datastore.key([BOAT, parseInt(req.params.id,10)]);
		boat = await get_Boat(key);
	
	
	if(boat == null){
		error = {"Error": "No boat with this boat_id exists"}
		res.status(404).send(error);
		return;
	}
		
	var boatCapacityTaken = await getBoatUsedCapacity(boat);
	if(boatCapacityTaken> req.body.capacity){
		error = {"Error": "Too much cargo on this boat to set the capacity this low"}
		res.status(400).send(error);
		return;
	}else{
		update_Boat(req.params.id,req.body.departureLocation, req.body.destination, req.body.capacity).then(key => {get_Boat(key).then(data => {res.status(200).send(data)});
		});
	}

});

app.get('/boats/:id', async (req, res) => {
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const key = datastore.key([BOAT, parseInt(req.params.id,10)]);
	boat = await get_Boat(key);
	if(boat == null){
		error = {"Error": "No boat with this boat_id exists"  }
		res.status(404).send(error);
		return;
	}else{
		res.status(200).send(boat);
	}
	
});


/* ------------- Load Routes -------------------------- */

app.post('/loads', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const key = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(key);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	contentType = req.header('Content-type');
	if(contentType != "application/json"){
		error = {"Error": "only json accepted"}
		res.status(415).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.volume || !req.body.content || req.body.fragile == undefined){
		error = {"Error": "The request object is missing the required volume or content"}
		res.status(400).send(error);
		return;
	}
	else{
	post_Load(req, userid)
    .then( key => {get_Load(key).then(data => {res.status(201).send(data)});
		});
	}
});

app.get('/loads/:id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const key = datastore.key([LOAD, parseInt(req.params.id,10)]);
	load = await get_Load(key);
	if(load == null){
		error = {"Error": "No load with this load_id exists"  }
		res.status(404).send(error);
		return;
	}else if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	else{
		res.status(200).send(load);
	}
	
});

app.patch('/loads/:id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.volume && !req.body.content && req.body.fragile==undefined){
		error = {"Error": "The request object is missing at least one of the required attributes"}
		res.status(400).send(error);
		return;
	}
	const key = datastore.key([LOAD, parseInt(req.params.id,10)]);
	load = await get_Load(key);
	if(load == null){
		error = {"Error": "No load with this load_id exists"  }
		res.status(404).send(error);
		return;
	}else if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	else{
		update_Load(req.params.id,req.body.volume, req.body.content, req.body.fragile).then(key => {get_Load(key).then(data => {res.status(200).send(data)})});
	}
	
});

app.put('/loads/:id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	if(!req.body.volume || !req.body.content || req.body.fragile==undefined){
		error = {"Error": "The request object is missing at least one of the required attributes"}
		res.status(400).send(error);
		return;
	}
	const key = datastore.key([LOAD, parseInt(req.params.id,10)]);
	load = await get_Load(key);
	if(load == null){
		error = {"Error": "No load with this load_id exists"  }
		res.status(404).send(error);
		return;
	}else if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	else{
		update_Load(req.params.id,req.body.volume, req.body.content, req.body.fragile).then(key => {get_Load(key).then(data => {res.status(200).send(data)})});
	}
	
});

app.get('/loads', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const key = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(key);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	var loads = get_Loads(userid, req)
	.then( (loads) => {
        res.status(200).json(loads);
    });
});

app.delete('/loads/:id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const key = datastore.key([LOAD, parseInt(req.params.id,10)]);
	load = await get_Load(key);
	if(load == null){
		error = {"Error": "No load with this load_id exists" }
		res.status(404).send(error);
		return;
	}else if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	else{
		delete_Load(req.params.id).then(res.status(204).end());
	}
});

app.get('/boats/:boat_id/loads', async (req, res) => {
	acceptType = req.header('Accept');
	if(acceptType != "application/json"){
		error = {"Error": "only json returned"}
		res.status(406).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const boat_key = datastore.key([BOAT, parseInt(req.params.boat_id,10)]);
	[boat] = await datastore.get(boat_key);
	if(boat==null){
		error = {"Error": "The specified boat does not exist" }
		res.status(404).send(error);
		return;
	}
	else{
		formattedBoat = await get_Boat(boat_key);
		res.status(200).json(formattedBoat.loads);
	}
});

app.put('/boats/:boat_id/loads/:load_id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const boat_key = datastore.key([BOAT, parseInt(req.params.boat_id,10)]);
	[boat] = await datastore.get(boat_key);
	const load_key = datastore.key([LOAD, parseInt(req.params.load_id,10)]);
	var [load] = await datastore.get(load_key);
	if(load == null || boat==null){
		error = {"Error": "The specified boat and/or load does not exist" }
		res.status(404).send(error);
		return;
	}
	if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	var boatCapacityTaken = await getBoatUsedCapacity(boat);
	if(boat.capacity-boatCapacityTaken< load.volume){
		error = {"Error": "Not enough room on this boat"}
		res.status(400).send(error);
		return;
	}
	load.id = load_key.id;
	if(load.carrier != null){
		error = {"Error": "The specified load is already on a boat" }
		res.status(403).send(error);
		return;
	}
	else{
		boat.loads.push({"id": load.id});
		await datastore.update({"key":boat_key, "data":boat});
		load.carrier = {"id": boat_key.id, "departureLocation": boat.departureLocation, "destination": boat.destination};
		await datastore.update({"key":load_key, "data":load});
		res.status(204).end();
	}
});


app.delete('/boats/:boat_id/loads/:load_id', async (req, res) => {
	idToken = req.header('authorization');
	if(!idToken){
		error = {"Error": "token is not present"}
		res.status(401).send(error);
		return;
	}
	idToken = idToken.replace('Bearer ','');
	userid = null;
	try{
		const ticket = await client.verifyIdToken({idToken,client_id});
		const payload = ticket.getPayload();
		userid = payload['sub'];
	} catch (error) {
		error = {"Error": "token is not valid"}
		res.status(401).send(error);
		return;
	}
	const userkey = datastore.key([USER, parseInt(userid,10)]);
	user = await get_User(userkey);
	if(user==null){
		error = {"Error": "This user does not have an account"}
		res.status(401).send(error);
		return;
	}
	address = req.protocol + "://" + req.get("host");
	const boat_key = datastore.key([BOAT, parseInt(req.params.boat_id,10)]);
	[boat] = await datastore.get(boat_key);
	const load_key = datastore.key([LOAD, parseInt(req.params.load_id,10)]);
	var [load] = await datastore.get(load_key);
	if(load == null || boat==null){
		error = {"Error": "The specified boat and/or load does not exist" }
		res.status(404).send(error);
		return;
	}
	if(load.owner != userid){
		error = {"Error": "You are not the owner of this load"}
		res.status(403).send(error);
		return;
	}
	load.id = load_key.id;
	if(load.carrier == null){
		error = {"Error": "The specified load is not on this boat" }
		res.status(403).send(error);
		return;
	}
	else if(load.carrier.id != boat_key.id){
		error = {"Error": "The specified load is not on this boat" }
		res.status(403).send(error);
		return;
	}
	else{
		await boat_removeLoad(load.id,boat_key);
		load.carrier = null;
		await datastore.update({"key":load_key, "data":load});
		res.status(204).end();
	}
});

/* ------------- User Routes -------------------------- */
app.get('/users', async (req, res) => {
	var users = get_Users()
	.then( (users) => {
        res.status(200).json(users.items);
    });
});


// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
var server = app.listen(PORT, () => {
});