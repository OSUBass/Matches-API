const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const axios = require('axios');
const {Datastore} = require('@google-cloud/datastore');

const datastore = new Datastore({
    projectId: 'cloudport-351121',
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(bodyParser.json());
app.enable('trust proxy');

app.set('view engine', 'ejs')

const clientSecretData = require('./client_secret.json');

const clientID = clientSecretData.web.client_id;
const clientSecret = clientSecretData.web.client_secret;

//const redirectU = 'https://assign7-350122.uc.r.appspot.com/oauth';
//const userPage = 'https://assign7-350122.uc.r.appspot.com/user';
const redirectU = 'http://localhost:8080/oauth';
const userPage = 'http://localhost:8080/user';

const {OAuth2Client} = require('google-auth-library');
const client = new OAuth2Client(clientID, clientSecret, redirectU);

var jwsData ='';
var options = {idToken: jwsData, audience: clientID};
var payload;

const MATCH = "Match";
const REF = "Ref";
const MANAGER = "Manager";
const STATE = "State";

/*map function to format datastore items*/
function fromDatastore(item) {
  item.id = item[Datastore.KEY].id;
  return item;
}

//Saves info to datastore
function datastoreSave(key, data){
    return datastore.save({ "key": key, "data": data }).then(()=> {
        return datastore.get(key).then((entity) => {
            //return fromDatastore(entity[0]);
            return entity.map(fromDatastore);
        });
    });
  }

  //makes post request to get accessToken, token_ID (JWS data) & user Info
async function getTokens(requestToken){
    var accessTokenData = await axios.post(`https://oauth2.googleapis.com/token?code=${requestToken}&client_id=${clientID}&client_secret=${clientSecret}&redirect_uri=${redirectU}&grant_type=authorization_code`)
    //var accessToken = accessTokenData.data.access_token;
    jwsData = await accessTokenData.data.id_token;
    var payloadId = await verify(jwsData);
    var userData = {last: payload.family_name, first: payload.given_name, jws: jwsData};
    return userData;
  }

//code from Google: https://developers.google.com/identity/sign-in/web/backend-auth to verify jws
//and retrieve "sub" info
async function verify(idToken){
    try{
      options.idToken = idToken;
      const ticket = await client.verifyIdToken(options);
      payload = ticket.getPayload();
      return payload.sub;
    }catch(rej){
      console.log(rej);
      return 401;
    }
  }

//generates a random 10 chracter "state"
function stateGenerator(){
    const char = '0123456789_-qwertyuioplkjhgfdsazxcvbnmQWERTYUIOPLKJHGFDSAZXCVBNM';
    var makeState = '';
    for(let i = 0; i < 10; i++){
      let newChar = char[Math.floor(Math.random() * (char.length-1))];
      makeState = makeState.concat(newChar);
    }
    return makeState;
  }

//checks to see if state returned from google server matches a state in datastore
async function findState(state){
    var stateQ = datastore.createQuery(STATE);
    qResults = {};
    return datastore.runQuery(stateQ).then((state) => {
        qResults.state = state[0].map(fromDatastore);
        for(var item of qResults.state){
            if(item.value === state){
                return true}
        }
        return false;
    });
}

/*********************************************Match Functions*************************************/

//create match with provided info
async function post_match(name, league, day, user, req) {
    try{
        var key = datastore.key(MATCH);
        var new_match = { "name": name, "league": league, "day": day, "manager": user, "refs": []};
        new_match = await datastoreSave(key, new_match);
        new_match[0].self = req.protocol + "://" + req.get("host") + "/match" + `/${new_match[0].id}`; 
        return new_match[0];
    }catch (error) {
        console.error(error)
    }
  }
  
//returns an array of all matches listed for verified user_id
async function get_match(user_id,req){
    console.log(owner_id)
    var boatQ = datastore.createQuery(BOAT).limit(5).filter("owner =", owner_id);
    var qResults = {};
    if(Object.keys(req.query).includes("cursor")){
        boatQ = boatQ.start(req.query.cursor);
    }
    var all_boats = await datastore.runQuery(boatQ);
    console.log(all_boats);
    all_boats = all_boats[0].map(fromDatastore);
    console.log(all_boats);
    qResults.boats = all_boats;
        //qResults.boats =  boat[0].map(fromDatastore).filter(item => item.owner === owner_id);
        //qResults.boats =  boat[0].map(fromDatastore);
        // console.log(qResults.boats);
        // for (var item of qResults.boats){
        //     item.self = req.protocol + "://" + req.get("host") + "/boats" + `/${item.id}`;
        // };
        // if (all_boats[1].moreResults !== Datastore.NO_MORE_RESULTS ){
        //     qResults.next = req.protocol + "://" + req.get("host") + "/boats" + "?cursor=" + all_boats[1].endCursor;
        //     }
        return qResults; 
}
  
  //if JWT is valid, returns an array with all boats with owner matching JWT 'sub'.
  //if JWT is not valid or missing, returns an array with all public boats regardless of owner.
  async function get_all_boats(owner_id){
    const boatsQ = datastore.createQuery(BOAT);
    var boat = await datastore.runQuery(boatsQ);
    if (owner_id !== undefined){
      owner_id = owner_id.slice(7);
      owner_id = await verify(owner_id);
        if (owner_id !== 401){
          return await boat[0].map(fromDatastore).filter(item => item.owner === owner_id);
        }
    }
      return boat[0].map(fromDatastore).filter(item => item.public === true);
  }
  
/*Deletes a specific boat with boat_id provided if current owner owns provided boat*/
function delete_boat(boat_id, owner) {
const key = datastore.key([BOAT, parseInt(boat_id, 10)]);
return datastore.get(key).then((boat) =>{
    if (boat[0] === undefined || boat[0] === null){
        return 403;
    }else if(boat[0].owner !== owner){
        return 403;
    }else{
        return datastore.delete(key);              
    };
});
}
/*********************************************Ref Functions*************************************/
function post_load(volume, item, req, creation_date) {
    const key = datastore.key(LOAD);
    const new_load = { "volume": volume, "item": item, "creation_date": creation_date, "carrier": null};
    return datastore.save({ "key": key, "data": new_load }).then(() => { 
        new_load.id = key.id;
        new_load.self = req.protocol + "://" + req.get("host") + "/loads" + `/${key.id}`;
        return new_load;
    });
}

function get_loads(req) {
    var loadQ = datastore.createQuery(LOAD).limit(3);
    var qResults = {};
    if(Object.keys(req.query).includes("cursor")){
        loadQ = loadQ.start(req.query.cursor);
    }
    return datastore.runQuery(loadQ).then((loads) => {
        qResults.loads = loads[0].map(fromDatastore);
        for (var load of qResults.loads){
            load.self = req.protocol + "://" + req.get("host") + "/loads" + `/${load.id}`;
        }
        if(loads[1].moreResults !== Datastore.NO_MORE_RESULTS ){
            qResults.next = req.protocol + "://" + req.get("host") + "/loads" + "?cursor=" + loads[1].endCursor;
        }
        return qResults;
    });
}

/*deletes boat datastore or identifies if boat id does not exist*/
function delete_load(id) {
    const key = datastore.key([LOAD, parseInt(id, 10)]);
    return datastore.get(key).then((load) =>{
        if (load[0] === undefined || load[0] === null){
            return 404;
        }else{
            const boat_key = datastore.key([BOAT, parseInt(load[0].carrier, 10)]);
            return datastore.get(boat_key).then((boat) =>{
                boat_loads = boat[0].loads;
                const new_loads = boat_loads.filter(loads => loads !== id);
                boat[0].loads = new_loads;
                return datastore.save({ "key": boat_key, "data": boat[0]}).then(() => { 
                    datastore.delete(key);
                        return 204;
                });
            });
        }
    });
}

function get_load(load_id, req) {
    const key = datastore.key([LOAD, parseInt(load_id, 10)]);
    return datastore.get(key).then((entity) => {
        if (entity[0] === undefined || entity[0] === null) {
            // No entity found.
            return 404;
        } else {
            var theLoad = entity.map(fromDatastore);
            theLoad[0].self = req.protocol + "://" + req.get("host") + "/loads" + `/${load_id}`;
            if(theLoad[0].carrier !== null){
                return get_load_carrier(load_id).then((new_boat)=>{
                    theLoad[0].carrier = {"id": new_boat[0].id, "name": new_boat[0].name, "self": req.protocol + "://" + req.get("host") + "/boats" + `/${new_boat[0].id}`};
                    return theLoad;
                });
            }else{return theLoad};
        };
    });
}

function put_load_on_boat(boat_id, load_id){
    const load_key = datastore.key([LOAD, parseInt(load_id, 10)]);
    const boat_key = datastore.key([BOAT, parseInt(boat_id, 10)]);
    return datastore.get(boat_key).then((boat) =>{
        var boat_entity = boat;
        if (boat[0] === undefined || boat[0] === null){return 404};
        return datastore.get(load_key).then((load) =>{
            if (load[0] === undefined || load[0] === null){return 404}
            else if (load[0].carrier !== null){return 403}
            else{
                load[0].carrier = boat_id;
                boat_entity[0].loads.push(load_id);
                datastore.save({"key": load_key, "data": load[0]});
                datastore.save({"key": boat_key, "data": boat_entity[0]});
                return 204;
            }
        });
    });
}

function delete_load_on_boat(boat_id, load_id){
    const load_key = datastore.key([LOAD, parseInt(load_id, 10)]);
    const boat_key = datastore.key([BOAT, parseInt(boat_id, 10)]);
    return datastore.get(boat_key).then((boat) =>{
        boat_entity = boat;
        if (boat[0] === undefined || boat[0] === null){return 404};
        return datastore.get(load_key).then((load) =>{
            if (load[0] === undefined || load[0] === null){return 404}
            else if (load[0].carrier !== boat_id){return 404}
            else{
                load[0].carrier = null;
                datastore.save({"key": load_key, "data": load[0]});
                /*filter load array for boat to create new array w/o specified load*/
                new_loads = boat_entity[0].loads.filter(function(loads){return loads !== load_id;});
                /*modify entity with new array sans specified load and save to datastore*/
                boat_entity[0].loads = new_loads;
                datastore.save({"key": boat_key, "data": boat_entity[0]});
                return 204;
            }
        });
    });
}

function get_boat_all_loads(boat_id, req){
    const key = datastore.key([BOAT, parseInt(boat_id, 10)]);
    return datastore.get(key).then((boat) => {
        if (boat[0] === undefined || boat[0] === null) {
            // No entity found.
            return 404;
        } else {
            return get_boat_loads(boat_id).then((new_load)=>{
                new_load.forEach((load)=>
                load.self = req.protocol + "://" + req.get("host") + "/loads" + `/${load.id}`); 
                var loads = {"loads": new_load};
                return loads;
            });
        }
    });
}
/*********************************************User Functions*************************************/

/*******************************************Oauth Routes*********************************************/
//render home page with initial link to google auth
app.get('/', function (req, res){
    var currentState = stateGenerator();
    var key = datastore.key(STATE);
    var new_state = {"value": currentState};
    datastore.save({ "key": key, "data": new_state }).then(()=>{
      res.render('index', {clientid : clientID, state : currentState, redirect : redirectU});
    })
  });
  
  // oauth redirect route
  app.get('/oauth', (req, res) => {
    const requestToken = req.query.code;
    const returnedState = req.query.state;
    goodState = findState(returnedState);
    if(goodState){
      getTokens(requestToken).then((userData) =>{
        res.redirect(`/user?last=${userData.last}&first=${userData.first}&jws=${userData.jws}`);
      });
    }else{
      console.log("Error: States do not match");
      res.send(401).json({'Error: ': 'States do not match'})
    }
  });
  
  //route to user page with user info displayed
  app.get('/user', function (req, res){
    var last = req.query.last;
    var first = req.query.first;
    var jws = req.query.jws;
    res.render('user', {last : last, first : first, jws : jws});
  });
  

  /*******************************************Match Routes*********************************************/
  //route for creating new match
  app.post('/match', function (req, res) {
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){res.status(401).json({"Error": "Authorization Token Missing"})
    }else{
      //remove "bearer" from front of header
      jwtAuth = jwtAuth.slice(7);
      return verify(jwtAuth).then((authId) =>{
        if(authId === 401){
          res.status(401).json({"Error": "Authorization Token is Incorrect/Expired"})
        }else{
            return post_match(req.body.name, req.body.league, req.body.day, authId, req)
            .then((info) =>{res.status(201).json(info);
            });
        }
      });
    }
  });
  
  //route for getting boats with specific owner_id
  app.get('/owners/:owner_id/boats', function(req, res){
    const boats = get_boats(req.params.owner_id)
    .then( (boat) => {
      const accepts = req.accepts(['application/json']);
      if(!accepts){
          res.status(406).send('Not Acceptable');
      } else if(accepts === 'application/json'){
          res.status(200).json(boat);
      } else { res.status(500).json({"Error":"Server Issue"}); }
    });
  });
  
  //route for getting all boats of logged in owner
  app.get('/boats', function (req, res) {
    jwtAuth = req.headers.authorization;
    const getBoats = get_boats(jwtAuth,req)
        .then((getBoats) => {
            res.status(200).json(getBoats);
        });
  });
  
  //route to delete boats for logged in owner
  app.delete('/boats/:boat_id', function (req, res) {
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
      res.status(401).json({"Error": "Authorization Token Missing"});
    }else{
      jwtAuth = jwtAuth.slice(7);
      return verify(jwtAuth).then((authId) =>{
        if(authId === 401){
          res.status(401).json({"Error": "Authorization Token is Incorrect"});
        }else{
          return delete_boat(req.params.boat_id, authId)
          .then((delete_response) =>{
            if(delete_response === 403){
              res.status(403).json({'Error': 'No boat owned by current user with this boat_id exists' });
            }else{
              res.status(204).end();
            };
          });
        };
      });
    };
  });

/*******************************************Ref Routes*********************************************/

/*lists all loads*/
app.get('/loads', function (req, res) {
    const allLoads = get_loads(req)
        .then((allLoads) => {
            res.status(200).json(allLoads);
        });
});

/*creates a new load. returns error if required load volume or item is missing*/
app.post('/loads', function (req, res) {
    if (req.body.volume === undefined || req.body.item === undefined || req.body.creation_date === undefined){
        res.status(400).json({'Error': 'The request object is missing at least one of the required attributes' });
    } else {
    post_load(req.body.volume, req.body.item, req, req.body.creation_date)
        .then(key => { 
            res.status(201).json(key)});
    }
});

/*Deletes slip with specified Id*/
app.delete('/loads/:load_id', function (req, res) {
    delete_load(req.params.load_id).then(delete_res =>{
        if (delete_res === 404) {
            res.status(404).json({'Error': 'No load with this load_id exists' });
        } else {
            res.status(204).end()
        }
    })
});

/*Gets a specific slip or indicates that slip does not exist*/
app.get('/loads/:load_id', function (req, res) {
    get_load(req.params.load_id, req)
        .then(load => {
            if (load === 404){
                res.status(404).json({ 'Error': 'No load with this load_id exists' });
            } else {
                // Return the 0th element which is the boat with this id
                res.status(200).json(load[0]);
            }
        });
});

/*Assigns a load to a boat*/
app.put('/boats/:boat_id/loads/:load_id', function (req, res) {
    put_load_on_boat(req.params.boat_id, req.params.load_id)
        .then(result => {
            if (result === 404) {
                res.status(404).json({ 'Error': 'The specified boat and/or load does not exist' })
            }else if(result === 403) {
                res.status(403).json({ 'Error': 'The load is already loaded on another boat'}) 
            }else{
                res.status(204).end()
            }
        });
});

/*delete specific load from a boat*/
app.delete('/boats/:boat_id/loads/:load_id', function (req, res) {
    delete_load_on_boat(req.params.boat_id, req.params.load_id)
    .then(result => {
        if (result === 404) {
            res.status(404).json({'Error':'No boat with this boat_id is loaded with the load with this load_id'})
        }else{
            res.status(204).end()
        }
    });
});

/*get all loads on specific boat*/
app.get('/boats/:boat_id/loads', function (req,res){
    get_boat_all_loads(req.params.boat_id, req)
    .then(boat => {
        if (boat === 404) {
            res.status(404).json({ 'Error': 'No boat with this boat_id exists' });
        } else {
            res.status(200).json(boat);
        }
    });
});


// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});