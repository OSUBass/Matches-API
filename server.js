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
const redirectU = 'http://localhost:8080/oauth';

const {OAuth2Client} = require('google-auth-library');
const { match } = require('assert');
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

/*Saves info to datastore*/
function datastoreSave(key, data){
    return datastore.save({ "key": key, "data": data }).then(()=> {
        return datastore.get(key).then((entity) => {
            return entity.map(fromDatastore);
        });
    });
}

/*makes post request to get accessToken, token_ID (JWS data) & user Info*/
async function getTokens(requestToken){
    try{
        var accessTokenData = await axios.post(`https://oauth2.googleapis.com/token?code=${requestToken}&client_id=${clientID}&client_secret=${clientSecret}&redirect_uri=${redirectU}&grant_type=authorization_code`)
        jwsData = await accessTokenData.data.id_token;
        var payloadId = await verify(jwsData);

        var key = datastore.key([MANAGER, payload.sub]);
        var new_user = {"id": payload.sub, "first_name": payload.given_name, "last_name": payload.family_name, "gyms": []};
        new_user = await datastoreSave(key, new_user);
        return userData;
    }catch(rej){
        return 401;
    }
}

/*code from Google: https://developers.google.com/identity/sign-in/web/backend-auth to verify jws */
/*  and retrieve "sub" info*/
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

/*generates a random 10 chracter "state"*/
function stateGenerator(){
    const char = '0123456789_-qwertyuioplkjhgfdsazxcvbnmQWERTYUIOPLKJHGFDSAZXCVBNM';
    var makeState = '';
    for(let i = 0; i < 10; i++){
      let newChar = char[Math.floor(Math.random() * (char.length-1))];
      makeState = makeState.concat(newChar);
    }
    return makeState;
}

/*checks to see if state returned from google server matches a state in datastore*/
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

/************************************************************************************************/
/*********************************************Match Functions*************************************/
/************************************************************************************************/

/*checks if gym is already scheduled for a match on day given*/
async function conflicts(name,day){
    try{
        var matchQ = await datastore.createQuery(MATCH).filter('name', '=', name). filter('day','=', day);
        var matches = await datastore.runQuery(matchQ);
        if (matches[0].length > 0) {return true};
        return false;
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*create match with provided info*/
async function post_match(name, league, day, user, req) {
    try{
        if(await conflicts(name,day)){return 403};  //check for schedule conflicts at the gym
        
        //save new match info in datastore
        var key = datastore.key(MATCH);
        var new_match = { "name": name, "league": league, "day": day, "manager": user, "refs": []};
        new_match = await datastoreSave(key, new_match);
        new_match[0].self = req.protocol + "://" + req.get("host") + "/match" + `/${new_match[0].id}`; 
        
        //add gym name to gym manager logged in if it does not already exist. Save to datastore
        const man_key = datastore.key([MANAGER, user]);
        var manager = await datastore.get(man_key)
        if (!(manager[0].gyms).includes(name)){
            (manager[0].gyms).push(name)
            new_gym = await datastoreSave(man_key, manager[0]);
        }

        return new_match[0];
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*attaches ref self links to match.refs*/
function ref_links(match, req){
    //if refs exist in match profile, replace id's with self links to ref(s)
    if ((match.refs).length > 0){
        for(let i = 0 ; i < (match.refs).length; i++){
            match.refs[i] = req.protocol + "://" + req.get("host") + "/ref" + `/${match.refs[i]}`;
        }
    }
    return match
}

/*View a specific match with provided match_id*/
function get_match(match_id,req, user) {
    const key = datastore.key([MATCH, parseInt(match_id, 10)]);
    return datastore.get(key).then((match) => {
        if (match[0] === undefined || match[0] === null) {
            return 404; // No entity found. Don't try to add the id attribute
        }else if(match[0].manager !== user){
            return 403; // user logged in does not match gym manager saved in datastore for match_id
        } else {
            match[0].self = req.protocol + "://" + req.get("host") + "/match" + `/${match_id}`;
            var theMatch = match.map(fromDatastore);
            theMatch = ref_links(theMatch[0], req)  //replace ref id's with links to refs
            return theMatch;
            
        }
    });
}

/*returns an array of all matches listed for verified gym manager(user)*/
async function get_matches(user_id,req){
    try{
        //query up to 5 matches where manager listed for match = logged in user
        var matchQ = datastore.createQuery(MATCH).filter("manager", "=", user_id).limit(5);
        var qResults = {};
        if(Object.keys(req.query).includes("cursor")){
            matchQ = matchQ.start(req.query.cursor);
            //query keys to get the total # of matches listed for logged in user
            var countQ = datastore.createQuery(MATCH).filter("manager", "=", user_id).select('__key__');
            var keys = await datastore.runQuery(countQ)
            var total = keys[0].length
        }
        
        var all_matches = await datastore.runQuery(matchQ);
        qResults.match = all_matches[0].map(fromDatastore);
        
        //add self link and change ref id's to ref links for all matches
        for (var item of qResults.match){
            item.self = req.protocol + "://" + req.get("host") + "/match" + `/${item.id}`;
            item = ref_links(item, req)
        };
        if (all_matches[1].moreResults !== Datastore.NO_MORE_RESULTS ){
            qResults.next = req.protocol + "://" + req.get("host") + "/match" + "?cursor=" + all_matches[1].endCursor;
        }
        qResults.total_results = total  //total # of filtered matches
        return qResults; 
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*Allows for partial updating of match properties. absent properties remain unchanged.*/
async function patch_match(id, name, league, day, req, user) {
    try{
        const key = datastore.key([MATCH, parseInt(id, 10)]);
        var entity = await datastore.get(key);
        if (entity[0] === undefined || entity[0] === null){return 404} //match doesn't exist
        if (entity[0].manager !== user){ return 4030} //logged in user is not gym manager

        //if name or day is different after request is made
        if((name !== undefined && name !== entity[0].name) || (day !== undefined && day !== entity[0].day)){
            if (name !== undefined){
                if(typeof name !== "string"){return 400};
                if(name.length > 25 || name.length < 1){return 400};
                entity[0].name = name;
            }else{name = entity[0].name}

            //if day of match is changed, refs are deleted from match
            if (day !== undefined){
                if(typeof day !== "number"){return 400};
                if(day < 1 || day > 6){return 400};
                //add days back to any refs assigned to match
                if (entity[0].refs > 0){
                    (entity[0].refs > 0).forEach((ref)=> add_day_to_ref(ref ,entity[0].day));
                }
                entity[0].day = day
                entity[0].refs = []
            }else{day = entity[0].day}

            if(await conflicts(name,day)){return 403};  //check for schedule conflicts
        }

        if (league !== undefined){
            if(typeof league !== "string"){return 400};
            entity[0].league = league
        };
            patched_match = await datastoreSave(key, entity[0]);
            patched_match[0].self = req.protocol + "://" + req.get("host") + "/match" + `/${id}`;
            patched_match = ref_links(patched_match[0], req) //replace ref id's with links
            return patched_match;
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*requires full update of match properties (except match_id & manager).*/
async function put_match(id, name, league, day, user, req) {
    try{
        const key = await datastore.key([MATCH, parseInt(id, 10)]);
        var match = await datastore.get(key)
        if (match[0] === undefined || match[0] === null){return 404} //match doesn't exist
        if (match[0].manager !== user){return 4030} //user does not match manager for gym
        
        //check schedule conflict if gym or day are changed.
        if(name !== match[0].name || day !== match[0].day){
            if(await conflicts(name,day,true)){return 403};  //check for schedule conflicts at the gym)
        }
        //check for refs assigned to match and add days back to refs availability
        if (match[0].refs.length > 0){
            for(let i = 0; i< match[0].refs.length; i++){
                add_day_to_ref(match[0].refs[i], day)
            }
        }
        var new_put_match = {"name": name, "league": league, "day": day, "manager": user, "refs": []};
        datastoreSave(key,new_put_match);
        new_put_match.id = id;
        new_put_match.self = req.protocol + "://" + req.get("host") + "/match" + `/${id}`; 
        new_put_match = ref_links(new_put_match, req)  //replace ref id's with links
        return new_put_match;
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*Deletes a match with match_id provided*/
async function delete_match(match_id, owner) {
    try{
        const key = datastore.key([MATCH, parseInt(match_id, 10)]);
        var match = await datastore.get(key)
        if (match[0] === undefined || match[0] === null){
            return 404; //match doesn't exist
        }else if(match[0].manager !== owner){
            return 403; // logged in user does not match manager for this match
        }else{
            //add available days back to any refs listed for this match
            var refs = match[0].refs;
            if (refs.length > 0){
                for (let i = 0; i < refs.length; i++){
                    await add_day_to_ref(refs[i],match[0].day)
                }
            }
            datastore.delete(key); 
            return 204             
        };
    }catch(err){
        console.log(err)
        return 500;
    }
}

/***************gets ref info for ref's assigned to a specific match_id*/ 
async function get_match_all_refs(match_id, req, owner){
    try{
        const key = datastore.key([MATCH, parseInt(match_id, 10)]);
        var match = await datastore.get(key);
        if (match[0] === undefined || match[0] === null) {
            return 404;  //match does not exist
        }else if(match[0].manager !== owner){
            return 403; // logged in user does not match manager for this match
        } else {
            var refs_list = [];
            //get ref info and add to refs_list array
            if ((match[0].refs).length > 0){
                for(let i=0; i < (match[0].refs).length; i++){
                    var ref_info = await get_ref(match[0].refs[i], req)
                    refs_list.push(ref_info[0])
                }
            }
            return refs_list;  
        }
    }catch(err){
        console.log(err)
        return 500
    }
}
/************************************************************************************************/
/*********************************************Ref Functions**************************************/
/***********************************************************************************************/

/*Creates a ref with provided info*/
function post_ref(fname, lname, certified, available, req) {
    const key = datastore.key(REF);
    const new_ref = { "fname": fname, "lname": lname, "certified": certified, "available": available};
    return datastore.save({ "key": key, "data": new_ref }).then(() => { 
        new_ref.id = key.id;
        new_ref.self = req.protocol + "://" + req.get("host") + "/ref" + `/${key.id}`;
        new_ref.matches = []
        return new_ref;
    });
}

/*Gets a specific ref with provided ref_id*/
function get_ref(ref_id, req) {
    const key = datastore.key([REF, parseInt(ref_id, 10)]);
    return datastore.get(key).then((entity) => {
        if (entity[0] === undefined || entity[0] === null) {
            return 404;  // No match found.
        } else {
            var theRef = entity.map(fromDatastore);
            return search_refs(ref_id, false).then((all_matches)=>{
                theRef[0].self = req.protocol + "://" + req.get("host") + "/ref" + `/${ref_id}`;
                theRef[0].matches = add_match_url(all_matches, req) //add any assigned matches
                return theRef; 
            })
        }
    });
}

/*retrieve and list all refs*/
function get_all_refs(req) {
    var refQ = datastore.createQuery(REF).limit(5);
    var qResults = {};
    if(Object.keys(req.query).includes("cursor")){
        refQ = refQ.start(req.query.cursor);
    }
    return datastore.runQuery(refQ).then((refs) => {
        qResults.refs = refs[0].map(fromDatastore);
        for (var ref of qResults.refs){
            ref.self = req.protocol + "://" + req.get("host") + "/ref" + `/${ref.id}`;
            //find assigned matches for each ref and add match info
            var all_matches = search_refs(ref.id,false)
            ref.matches = add_match_url(all_matches, req)
        }
        
        if(refs[1].moreResults !== Datastore.NO_MORE_RESULTS ){
            qResults.next = req.protocol + "://" + req.get("host") + "/ref" + "?cursor=" + refs[1].endCursor;
        }
        //get total # of refs in datastore
        var countQ = datastore.createQuery(REF).select('__key__');
        return datastore.runQuery(countQ).then((keys)=>{
            qResults.total = keys[0].length;
            return qResults;
        })
    });
}

/*Allows for partial updating of a ref's properties. absent properties remain unchanged.*/
/*match assignments are removed if availablility is updated*/
async function patch_ref(id, fname, lname, certified, available,req) {
    try{
        const key = datastore.key([REF, parseInt(id, 10)]);
        var entity = await datastore.get(key);
        if (entity[0] === undefined || entity[0] === null){return 404} //ref doesn't exist

        if (fname !== undefined){
            if(typeof fname !== "string"){return 400};
            if(fname.length > 15 || fname.length < 1){return 400};
            entity[0].fname = fname;
        };
        
        if (lname !== undefined){
            if(typeof lname !== "string"){return 400};
            if(lname.length > 15 || lname.length < 1){return 400};
            entity[0].lname = lname;
        };

        if (certified !== undefined){
            entity[0].certified = certified
        };

        //if ref availability is changed, all match assignments are deleted
        if (available !== undefined){
            await search_refs(id, true) //deletes ref assignments from all matches
            entity[0].available = available
            entity[0].matches = []
        }else{
            //add assigned match info to this ref
            var all_matches = await search_refs(id, false)
            var matches = add_match_url(all_matches, req)
        }

        patched_ref = await datastoreSave(key, entity[0]);
        patched_ref[0].self = req.protocol + "://" + req.get("host") + "/ref" + `/${id}`; 
        patched_ref[0].matches = matches
        return patched_ref[0];
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*finds all matches where provided ref_id is assigned and forwards to delete_ref_from_match()*/
async function search_refs(ref_id, delete_ref){
    try{
        var matchQ = datastore.createQuery(MATCH).filter("refs", "=", ref_id);
        var all_matches = await datastore.runQuery(matchQ);
        all_matches = all_matches[0].map(fromDatastore);
        
        if(delete_ref){    
            for (var item of all_matches){
                await delete_ref_from_match(item.id, ref_id)
            };
        }else{return all_matches}
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*requires full update of a ref's properties (except ref_id). all properties must be listed*/
/*all match assignments are removed upon update*/
async function put_ref(id, fname, lname, certified, available,req) {
    try{
        const key = datastore.key([REF, parseInt(id, 10)]);
        var entity = await datastore.get(key)
        if (entity[0] === undefined || entity[0] === null){return 404}
        new_put_ref = {"fname": fname, "lname": lname, "certified": certified, "available": available};
        await datastore.save({ "key": key, "data": new_put_ref });
        await search_refs(id, true) //deletes ref assignments from all matches
        new_put_ref.id = id;
        new_put_ref.self = req.protocol + "://" + req.get("host") + "/ref" + `/${id}`;
        new_put_ref.matches = []
        return new_put_ref;
    }catch(err){
        console.log(err)
        return 500;
    }
}

/*delete ref or identify if ref id does not exist*/
function delete_ref(ref_id) {
    const key = datastore.key([REF, parseInt(ref_id, 10)]);
    return datastore.get(key).then((ref) =>{
        if (ref[0] === undefined || ref[0] === null){
            return 404; //ref does not exist
        }else{
            //deletes ref assignments from all matches
            search_refs(ref_id, true).then(()=>{
                datastore.delete(key).then(()=>{
                    return 204})
            })
        }
    });
}

/*adds ref to a match if they are available and match needs another ref*/
function put_ref_on_match(match_id, ref_id, req){
    const ref_key = datastore.key([REF, parseInt(ref_id, 10)]);
    const match_key = datastore.key([MATCH, parseInt(match_id, 10)]);
    return datastore.get(match_key).then((match) =>{
        if (match[0] === undefined || match[0] === null){return 404}; //match doesn't exist
        return datastore.get(ref_key).then((ref) =>{
            if (ref[0] === undefined || ref[0] === null){return 404} //ref doesn't exist
            
            if (match[0].refs.length === 2){
                return 403};  //match already has 2 refs
            
            //confirm ref is available on match day, then add ref to match and delete day from ref availability
            for(let i=0; i < match[0].day; i++){
                if (ref[0].available[i]=== match[0].day){
                    match[0].refs.push(ref_id); //add ref_id to match refs
                    ref[0].available.splice(i,1); //remove day from ref availability
                    
                    //safe new ref and match info to datastore
                    datastore.save({"key": ref_key, "data": ref[0]});
                    return datastoreSave(match_key, match[0])
                    .then((theMatch)=>{
                        theMatch[0].self = req.protocol + "://" + req.get("host") + "/match" + `/${match_id}`;
                        theMatch = ref_links(theMatch[0], req) //replace ref id's with links
                        return theMatch;
                    })
                }
            }
            return 403 //ref is not available on match day
        });
    });
}

/*deletes a specific ref from a specific match*/
function delete_ref_from_match(match_id, ref_id, add_days){
    const ref_key = datastore.key([REF, parseInt(ref_id, 10)]);
    const match_key = datastore.key([MATCH, parseInt(match_id, 10)]);
    return datastore.get(match_key).then((match) =>{
        match_entity = match;
        
        //confirm both match_id & ref_id are valid
        if (match[0] === undefined || match[0] === null){return 404};
        return datastore.get(ref_key).then((ref) =>{
            if (ref[0] === undefined || ref[0] === null){return 404}
            
            //return forbidden status if ref is not shown to officiate this match
            else if (!match[0].refs.includes(ref_id)){return 403}
            else{
                
                //add days back to refs available schedule
                if(add_days){
                    add_day_to_ref(ref_id, match[0].day);
                }

                /*create new refs array by filtering to remove specified ref*/
                new_refs = match[0].refs.filter(function(refs){return refs !== ref_id;});

                /*modify match in datastore with new array sans specified ref*/
                match[0].refs = new_refs;
                datastore.save({"key": match_key, "data": match[0]}).then(()=>{return 204;})
            }
        });
    });
}

/*adds day back to ref availability & saves to datastore*/
function add_day_to_ref(ref_id, day){
    const ref_key = datastore.key([REF, parseInt(ref_id, 10)]);
    return datastore.get(ref_key).then((ref) =>{
        ref[0].available.push(day)
        //sort array of available days.  from https://www.w3schools.com/jsref/jsref_sort.asp
        ref[0].available = (ref[0].available).sort(function(a, b){return a-b});
        datastore.save({"key": ref_key, "data": ref[0]});
    });
}

/*adds the self url and specific details to json for ref display*/
function add_match_url(all_matches, req){
    var matches = []
        for (let i = 0; i<all_matches.length; i++){
            let url = req.protocol + "://" + req.get("host") + "/match" + `/${all_matches[i].id}`;
            let deets = {gym: all_matches[i].name, day:all_matches[i].day, self: url}
            matches.push(deets);
        }
    return matches
}

/************************************************************************************************/
/*********************************************User Functions*************************************/
/************************************************************************************************/

/*retrieve and list all users (gym managers)*/
function get_all_users(req) {
    var userQ = datastore.createQuery(MANAGER).limit(5);
    var qResults = {};
    if(Object.keys(req.query).includes("cursor")){
        userQ = userQ.start(req.query.cursor);
    }
    return datastore.runQuery(userQ).then((users) => {
        qResults.users = users[0];
        for (var mans of qResults.users){
            mans.self = req.protocol + "://" + req.get("host") + "/users" + `/${mans.id}`;
        }
        if(users[1].moreResults !== Datastore.NO_MORE_RESULTS ){
            qResults.next = req.protocol + "://" + req.get("host") + "/ref" + "?cursor=" + users[1].endCursor;
        }
        return qResults;
    });
}

/************************************************************************************************/
/***************************************Oauth Routes*********************************************/
/************************************************************************************************/

/*render home page with initial link to google auth*/
app.get('/', function (req, res){
    var currentState = stateGenerator();
    var key = datastore.key(STATE);
    var new_state = {"value": currentState};
    datastore.save({ "key": key, "data": new_state }).then(()=>{
      res.render('index', {clientid : clientID, state : currentState, redirect : redirectU});
    })
  });

/* oauth redirect route*/
app.get('/oauth', (req, res) => {
    const requestToken = req.query.code;
    const returnedState = req.query.state;
    goodState = findState(returnedState);
    if(goodState){
        getTokens(requestToken).then((userData) =>{
        res.redirect(`/user`);    
    });
    }else{
        console.log("Error: States do not match");
        res.send(401).json({'Error: ': 'States do not match'})
    }
});

/*route to user page with user info displayed*/
app.get('/user', function (req, res){
    res.render('user', {last : payload.family_name, first : payload.given_name, jws : jwsData, user: payload.sub});
});

/************************************************************************************************/
/*******************************************Match Routes*********************************************/
/************************************************************************************************/

/*route for creating new match*/
app.post('/match', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
    }else{
        jwtAuth = jwtAuth.slice(7);   //remove "bearer" from front of header
        return verify(jwtAuth)
        .then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
            }else if(req.body.name === undefined | req.body.league === undefined | req.body.day === undefined){
                    res.status(400).json({"Error":"The request object is incorrect"});
            }else if(!accepts){
                res.status(406).json({'Error':'Not Acceptable'});
            }else if(accepts === 'application/json'){
                return post_match(req.body.name, req.body.league, req.body.day, authId, req)
                .then((info) =>{
                    if(info === 403){
                        res.status(403).json({'Error': 'This gym already has a match scheduled for the day indicated'});
                    }else if(info === 500){res.status(500).end()}
                    else{res.status(201).json(info);}
                });
            }else{ res.status(500).end()}
        });
    }
});

/*get a single match with the provided id and determine when no match exists with that ID.*/
app.get('/match/:match_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
    }else{
      jwtAuth = jwtAuth.slice(7);  //remove "bearer" from front of header
      return verify(jwtAuth)
      .then((authId) =>{
        if(authId === 401){
          res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
        }else if(!accepts){
              res.status(406).json({'Error':'Not Acceptable'});
        }else if(accepts === 'application/json'){
            return get_match(req.params.match_id, req, authId)
            .then(match => {
                if (match === 404) {
                    res.status(404).json({ 'Error': 'No match with this match_id exists' });
                }else if (match === 403){
                    res.status(403).json({ 'Error': 'Current user is not authorized'})
                }else if( match === 500){
                    res.status(500).end()     
                }else{res.status(200).json(match);}
            });
        }else{res.status(500).end()}
      })
    }
});

/*route for getting all matches for logged in user*/
app.get('/match', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
        res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
    }else{
        jwtAuth = jwtAuth.slice(7);
        return verify(jwtAuth).then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
            }else if(!accepts){
                    res.status(406).json({'Error':'Not Acceptable'});
            }else if(accepts === 'application/json'){
                return get_matches(authId, req)
                    .then((allMatches) =>{
                        if(allMatches === 500){res.status(500).end()}
                        else{res.status(200).json(allMatches);}
                    });
            }else{ res.status(500).end()}
        });
    };
});

/*route for partial updating of match's properties.*/
app.patch('/match/:match_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
        res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
    }else{
        jwtAuth = jwtAuth.slice(7);
        return verify(jwtAuth).then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
            }else if(!accepts){
                res.status(406).json({"Error":'Not Acceptable'});
            } else if(accepts === 'application/json'){
                patch_match(req.params.match_id, req.body.name, req.body.league, req.body.day, req, authId)
                .then(patch_res =>{
                    if (patch_res === 404){
                        res.status(404).json({"Error": "No match with this match_id exists"});
                    }else if(patch_res === 400){
                        res.status(400).json({"Error": "The request object is incorrect"});
                    }else if(patch_res === 403){
                        res.status(403).json({"Error": "This gym already has a match scheduled for the day indicated"});
                    }else if(patch_res === 4030){
                        res.status(403).json({ 'Error': 'Current user is not authorized'})
                    }else if(patch_res === 500){
                        res.status(500).end()
                    }else{res.status(200).json(patch_res)} 
                });
            }else { res.status(500).end()}
        });
    }
});

/*route for full update of a match's properties. all properties must be listed*/
app.put('/match/:match_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
        res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
    }else{
        jwtAuth = jwtAuth.slice(7);
        return verify(jwtAuth).then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
            }else if(req.get('content-type') !== 'application/json'){
                res.status(415).json({'Error':'Server only accepts application/json data.'})
            }else if (req.body.name === undefined || req.body.league === undefined || req.body.day === undefined){
                res.status(400).json({"Error": "The request object is incorrect"});
            }else if(typeof req.body.name !== 'string' || typeof req.body.day !== 'number' || typeof req.body.league !== 'string'){
                res.status(400).json({"Error": "The request object is incorrect"});
            }else if(req.body.day > 6 || req.body.day < 1){
                res.status(400).json({"Error": "The request object is incorrect"});
            }else if(req.body.name > 25 || req.body.name < 1){
                res.status(400).json({"Error": "The request object is incorrect"});
            }else if(!accepts){
                res.status(406).json({'Error':'Not Acceptable'});
            }else if(accepts === 'application/json'){
                put_match(req.params.match_id, req.body.name, req.body.league, req.body.day, authId, req)
                    .then(put_res =>{
                        if (put_res === 404){
                            res.status(404).json({"Error": "No match with this match_id exists"});
                        }else if (put_res === 403){
                            res.status(403).json({"Error":"This gym already has a match scheduled for the day indicated"})
                        }else if (put_res === 4030){
                            res.status(403).json({ 'Error': 'Current user is not authorized'})
                        }else if (put_res === 500){
                            res.status(500).end()
                        }else{res.status(200).json(put_res);}
                    });
            }else {res.status(500).end()}
        });
    }
});
  
/*route to delete match for logged in user*/
app.delete('/match/:match_id', function (req, res) {
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
        res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
    }else{
        jwtAuth = jwtAuth.slice(7);
        return verify(jwtAuth).then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"});
            }else{
                return delete_match(req.params.match_id, authId)
                .then((delete_response) =>{
                    if(delete_response === 404){
                        res.status(404).json({'Error': 'No match with this match_id exists' });
                    }else if(delete_response ===403){
                        res.status(403).json({ 'Error': 'Current user is not authorized'})
                    }else if(delete_response ===500){
                        res.status(500).end();
                    }else{
                        res.status(204).end();
                    };
                });
            };
        });
    };
});

/*invalid route for match delete*/
app.delete('/match', function (req, res){
    res.set('Accept', 'GET');
    res.status(405).end();
});
/************************************************************************************************/
/*******************************************Ref Routes*********************************************/
/************************************************************************************************/

/*route that creates a new ref*/
app.post('/ref', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if (req.body.fname === undefined || req.body.lname === undefined || req.body.certified === undefined || req.body.available === undefined){
        res.status(400).json({'Error': 'The request object is incorrect' });
    }else if(!accepts){
        res.status(406).json({'Error':'Not Acceptable'});
    }else if(accepts){
        post_ref(req.body.fname, req.body.lname, req.body.certified, req.body.available, req)
            .then(key => {
                res.status(201).json(key)});
    }else{res.status(500).end()}
});

/*route that gets a specific ref or indicates that ref_id does not exist*/
app.get('/ref/:ref_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error':'Not Acceptable'});
    }else if(accepts){
        get_ref(req.params.ref_id, req)
        .then(load => {
            if (load === 404){
                res.status(404).json({ 'Error': 'No ref with this ref_id exists' });
            } else {
                res.status(200).json(load[0]);
            }
        });
    }else{res.status(500).end()}
});

/*route that lists all refs*/
app.get('/ref', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({'Error':'Not Acceptable'});
    }else if(accepts){
        const allRefs = get_all_refs(req)
        .then((allRefs) => {
            res.status(200).json(allRefs);
        });
    }else{res.status(500).end()}
});

/*route for partial updating of ref's properties.*/
app.patch('/ref/:ref_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if(req.get('content-type') !== 'application/json'){
        res.status(415).send('Server only accepts application/json data.')
    }else if(!accepts){
        res.status(406).json({"Error":'Not Acceptable'});
    }else if(accepts === 'application/json'){
        patch_ref(req.params.ref_id, req.body.fname, req.body.lname, req.body.certified, req.body.available, req)
        .then((patch_res) =>{
            if (patch_res === 404){
                res.status(404).json({"Error": "No ref with this ref_id exists"});
            }else if(patch_res === 400){
                res.status(400).json({"Error": "The request object is incorrect"});
            }else if(patch_res ===500){
                res.status(500).end()
            }else{res.status(200).json(patch_res);}
        });
    }else{res.status(500).end()}
});

/*route for full update of a ref's properties. all properties must be listed*/
app.put('/ref/:ref_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if(req.get('content-type') !== 'application/json'){
        res.status(415).json({'Error':'Server only accepts application/json data.'})
    }else if(!accepts){
        res.status(406).json({'Error':'Not Acceptable'});
    }else if (req.body.fname === undefined || req.body.lname === undefined || req.body.certified === undefined || req.body.available === undefined){
        res.status(400).json({"Error": "The request object is incorrect"});
    }else if(req.body.lname > 15 || req.body.lname < 1){
        res.status(400).json({"Error": "The request object is incorrect"});
    }else if(req.body.fname > 15 || req.body.fname < 1){
        res.status(400).json({"Error": "The request object is incorrect"});
    }else if(accepts === 'application/json'){
        put_ref(req.params.ref_id, req.body.fname, req.body.lname, req.body.certified, req.body.available, req)
        .then(put_res =>{
            if (put_res === 404){
                res.status(404).json({"Error": "No ref with this ref_id exists"});
            }else if(put_res === 500){
                res.status(500).end()
            }else{res.status(200).json(put_res);}
        });
    }else {res.status(500).end()}
});

/*Deletes ref with specified Id*/
app.delete('/ref/:ref_id', function (req, res) {
    delete_ref(req.params.ref_id).then(ref =>{
        if (ref === 404) {
            res.status(404).json({'Error': 'No ref with this ref_id exists' });
        }else{
            res.status(204).end()
        }
    })
});

/*invalid route for ref delete*/
app.delete('/ref', function (req, res){
    res.set('Accept', 'GET');
    res.status(405).end();
});

/************************************************************************************************/
/*******************************************Relationship Routes*********************************************/
/************************************************************************************************/

/*Assigns a ref to a match*/
app.put('/match/:match_id/:ref_id', function (req, res) {
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
    }else{
        //remove "bearer" from front of header
        jwtAuth = jwtAuth.slice(7);
        return verify(jwtAuth)
        .then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
            }else if(!accepts){
                res.status(406).json({"Error":'Not Acceptable'});
            }else if(accepts === 'application/json'){
                put_ref_on_match(req.params.match_id, req.params.ref_id, req)
                .then(result => {
                    if (result === 404) {
                        res.status(404).json({ 'Error': 'The specified match and/or ref does not exist' })
                    }else if(result === 403) {
                        res.status(403).json({ 'Error': 'The ref is unavailable or max refs have already been reached for this match'}) 
                    }else{res.status(200).json(result)}
                });
            }else{res.status(500).end()}
        })
    }
});

/*deletes specific ref_id from a match*/
app.delete('/match/:match_id/:ref_id', function (req, res) {
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){
        res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
    }else{
        jwtAuth = jwtAuth.slice(7); //remove "bearer" from front of header
        return verify(jwtAuth)
        .then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
            }else if (authID !== 401){
                delete_ref_from_match(req.params.match_id, req.params.ref_id, true)
                .then(result => {
                    if (result === 404) {
                        res.status(404).json({'Error':'The specified match and/or ref does not exist'})
                    }else if (result === 403) {
                        res.status(403).json({'Error':'The ref_id provided is not assigned to the match_id provided'})
                    }else{
                        res.status(204).end()
                    }
                });
            }else{res.status(500).end()}
        })
    }
});

/**get all refs for a specific match*/
app.get('/match/:match_id/ref', function (req,res){
    const accepts = req.accepts(['application/json']);
    jwtAuth = req.headers.authorization;
    if (jwtAuth === undefined){res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
    }else{
        jwtAuth = jwtAuth.slice(7);   //remove "bearer" from front of header
        return verify(jwtAuth)
        .then((authId) =>{
            if(authId === 401){
                res.status(401).json({"Error": "Authorization Token is Incorrect/Expired/Missing"})
            }else if(!accepts){
                    res.status(406).json({'Error':'Not Acceptable'});
            }else{
                get_match_all_refs(req.params.match_id, req, authId)
                .then(ref => {
                    if (ref === 404) {
                        res.status(404).json({ 'Error': 'No match with this match_id exists' });
                    }else if (ref === 500) {
                        res.status(500).end();
                    } else {
                        res.status(200).json(match);
                    }
                });
            }
        })
    }
});

/************************************************************************************************/
/*******************************************User Route*********************************************/
/************************************************************************************************/

/*route that lists all users (gym managers)*/
app.get('/users', function (req, res) {
    const accepts = req.accepts(['application/json']);
    if(!accepts){
        res.status(406).json({"Error":'Not Acceptable'});
    }else if(accepts === 'application/json'){
        get_all_users(req)
        .then((allUsers) => {
            res.status(200).json(allUsers);
        });
    }else{res.status(500).end()}
});


// Listen to the App Engine-specified port, or 8080 otherwise
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}...`);
});