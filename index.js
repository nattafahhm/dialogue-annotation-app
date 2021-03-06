// Dependencies
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const bodyParser = require('body-parser');
var _ = require('lodash');
const moment = require('moment-timezone');
const uuidv4 = require('uuid/v4');

const expressApp = express();

const {dialogflow} = require('actions-on-google');
const app = dialogflow({ debug: false});

const privateKey = fs.readFileSync('/etc/letsencrypt/live/dialog-labels.sozolab.jp/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/dialog-labels.sozolab.jp/cert.pem', 'utf8');
const ca = fs.readFileSync('/etc/letsencrypt/live/dialog-labels.sozolab.jp/chain.pem', 'utf8');

const credentials = {
	key: privateKey,
	cert: certificate,
	ca: ca
};

const db = require('./db');
const eneact = require('./eneact');

const RECORD_TYPES = {
	TIME_START: 'time-start',
	TIME_STOP: 'time-stop',
	TIME_PERIOD: 'time-period',
	START_RECORD: 'start',
	RECORDING: 'recording',
	STOP_RECORD: 'stop',
	SHOW: 'show',
	SHOW_ACT_TYPE: 'show_activity_types',
	LOGIN: 'login',
	CLEAR: 'clear',
	FALLBACK: 'fallback',
	OTHER: 'other'
}


app.intent('talk', async (conv, params) => {

	let responseText = await talk(conv, params);
	conv.ask(responseText);
	
})

async function talk(conv, params){

	let response = "";

	conv.user.storage.start = null;
	conv.user.storage.stop = null;
 
	if(!Array.isArray(conv.user.storage.activities)){
		conv.user.storage.dialogue = [];
		conv.user.storage.activities = [];
	}
	
	if(conv.user.storage.email && conv.user.storage.password){

			const activityResult = await db.getActivity(params['activity']);
				
			if(activityResult.length > 0){

				const user = {
					id: conv.user.storage.id,
					name: conv.user.storage.name, 
					email: conv.user.storage.email, 
					password: conv.user.storage.password
				};

				const activity = {
					id: activityResult[0].id,
					name: activityResult[0].name,
				};

				conv.user.storage.user = user;
				conv.user.storage.activity = activity;

				if (params['time-period']){

					const uuid = uuidv4();
					const timeStart = params['time-period'].startTime;
					const timeStop =  params['time-period'].endTime;
					const start = moment(timeStart).tz('Asia/Tokyo').format("hh:mm:ss a");
					const stop = moment(timeStop).tz('Asia/Tokyo').format("hh:mm:ss a");

					if(moment(timeStop).isAfter(timeStart)){
						let startActivity = {id: activity.id, name: activity.name, uuid: uuid, timestamp: timeStart}
						let stopActivity = {id: activity.id, name: activity.name, uuid: uuid, timestamp: timeStop}

						await eneact.upload(user, startActivity, stopActivity, (error)=> {			
							if(!error){
								const responseText = `${activity.name} is record from ${start} to ${stop}`;
								response = responseText;
								db.insertRowsAsStream(conv, responseText, timeStart, timeStop, RECORD_TYPES.TIME_PERIOD);
	
							}else{
								const responseText = `Cannot upload ${activity.name}`;
								response = responseText;
								db.insertRowsAsStream(conv, timeStart, timeStop, responseText, RECORD_TYPES.FALLBACK);
	
							}
						});
					}else{
						const responseText = `Start time ${start} must be earlier than end time ${stop}`;
						response = responseText;
						db.insertRowsAsStream(conv, responseText, timeStart, timeStop, RECORD_TYPES.FALLBACK);

					}

				
				}else{

					let recording = _.find(conv.user.storage.activities, { 'name': activity.name});
					if(recording === undefined) {

						const uuid = uuidv4();
						let timeStart = moment().tz('Asia/Tokyo').format();

						if(params['time-start']){
							timeStart = params['time-start'];

							dayTimeStart = moment(timeStart).tz('Asia/Tokyo').format("YMMDD");
							today = moment().tz('Asia/Tokyo').format("YMMDD");

							if(dayTimeStart != today){
								timeStart = moment(timeStart).subtract(1, 'days').tz('Asia/Tokyo').format()
							}
						}

						console.log("timeStart " + timeStart);

						const start = moment(timeStart).tz('Asia/Tokyo').format("hh:mm:ss a");
						let startActivity = {id: activity.id, name: activity.name, uuid: uuid, timestamp: timeStart}
						conv.user.storage.activities.push(startActivity);
		
						const responseText = `${activity.name} is started at ${start}`;
						response = responseText;
						db.insertRowsAsStream(conv, responseText, timeStart, null, RECORD_TYPES.START_RECORD);

					}else{
					
						let timeStart = moment().tz('Asia/Tokyo').format();
						if(params['time-start']){
							timeStart = params['time-start'];
							dayTimeStart = moment(timeStart).tz('Asia/Tokyo').format("YMMDD");
							today = moment().tz('Asia/Tokyo').format("YMMDD");
							if(dayTimeStart != today){
								timeStart = moment(timeStart).subtract(1, 'days').tz('Asia/Tokyo').format()
							}
							// if(!moment(timeStart).isSame(moment().tz('Asia/Tokyo').format(), 'day')){
							// 	timeStart = moment(timeStart).subtract(1, 'days').tz('Asia/Tokyo').format();
							// }
						}

						if(moment(timeStart).isAfter(recording.timestamp)){
							/** future activity */
							const responseText = `${activity.name} is recording`;
							response = responseText;
							db.insertRowsAsStream(conv, responseText, timeStart, null, RECORD_TYPES.RECORDING);
						
						}else{
							/** past activity */
							const uuid = uuidv4();								
							let startActivity = {id: activity.id, name: activity.name, uuid: uuid, timestamp: timeStart}
							conv.user.storage.startActivity = startActivity;
							conv.user.storage.isFollowup = true;

							const responseText = `When you have finished work?`;
							response = responseText;
							db.insertRowsAsStream(conv, responseText, timeStart, null, RECORD_TYPES.TIME_START);
						}
						
					}

				}
			
			}else{
				const responseText = `Sorry, could you say that again?`;
				response = responseText;
				db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
			}

	}else{
		const responseText = `Please login with ${eneact.API} account, by saying \'login\'`;
		response = responseText;
		db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);

	}	

	return response;

}


app.intent('stop', async (conv, params) => {

	const activityResult = await db.getActivity(params['activity']);
				
	if(activityResult.length > 0){

		const user = conv.user.storage.user;

		const activity = {
			id: activityResult[0].id,
			name: activityResult[0].name,
		};

		let recording = _.find(conv.user.storage.activities, { 'name': activity.name});

		if(recording === undefined) {
			const responseText = `You have not started ${activity.name} yet`;
			conv.ask(responseText);
			db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
			
		}else{

			let timeStop = moment().tz('Asia/Tokyo').format();
			if(params['time-stop']){
				timeStop = params['time-stop'];
				dayTimeStop = moment(timeStop).tz('Asia/Tokyo').format("YMMDD");
				today = moment().tz('Asia/Tokyo').format("YMMDD");
				if(dayTimeStop != today){
					timeStop = moment(timeStop).subtract(1, 'days').tz('Asia/Tokyo').format()
				}
				// if(!moment(timeStop).isSame(moment().tz('Asia/Tokyo').format(), 'day')){
				// 	timeStop = moment(timeStop).subtract(1, 'days').tz('Asia/Tokyo').format()
				// }
			}
			
			const stop = moment(timeStop).tz('Asia/Tokyo').format("hh:mm:ss a");
			if(moment(timeStop).isAfter(recording.timestamp)){
				/** time start before time stop */
				let stopActivity = {id: activity.id, name: activity.name, uuid: recording.uuid, timestamp: timeStop}
				await eneact.upload(user, recording, stopActivity, (error) => {			
					if(!error){
						conv.user.storage.activities = _.pullAllWith(conv.user.storage.activities, [recording], _.isEqual);
						const responseText = `${activity.name} is stopped at ${stop}`;
						conv.ask(responseText);
						db.insertRowsAsStream(conv, responseText, recording.timestamp, timeStop, RECORD_TYPES.STOP_RECORD);
					}else{
						const responseText = `Cannot upload ${activity.name}`;
						conv.ask(responseText);
						db.insertRowsAsStream(conv, responseText, null,null, RECORD_TYPES.FALLBACK);
					}
				});
			
			}else{

				const start = moment(recording.timestamp).tz('Asia/Tokyo').format("hh:mm:ss a");
				const stop = moment(timeStop).tz('Asia/Tokyo').format("hh:mm:ss a");
				const responseText = `Start time ${start} must be earlier than end time ${stop}`;
				conv.ask(responseText);
				db.insertRowsAsStream(conv, responseText, recording.timestamp, timeStop, RECORD_TYPES.FALLBACK);
			}
			
		}
	}else{
		const responseText = `Sorry, could you say that again?`;
		conv.ask(responseText);
		db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
	}

});

app.intent('time-stop', async (conv, params) => {
	
	if(conv.user.storage.isFollowup){
		
		let timeStop =  params['time-stop'];
		dayTimeStop = moment(timeStop).tz('Asia/Tokyo').format("YMMDD");
		today = moment().tz('Asia/Tokyo').format("YMMDD");
		if(dayTimeStop != today){
			timeStop = moment(timeStop).subtract(1, 'days').tz('Asia/Tokyo').format()
		}
		// if(!moment(timeStop).isSame(moment().tz('Asia/Tokyo').format(), 'day')){
		// 	timeStop = moment(timeStop).subtract(1, 'days').tz('Asia/Tokyo').format()
		// }

		const activity = conv.user.storage.startActivity;
		const start = moment(activity.timestamp).tz('Asia/Tokyo').format("HH:mm:ss a");
		const stop = moment(timeStop).tz('Asia/Tokyo').format("HH:mm:ss a");

		if(moment(timeStop).isAfter(activity.timestamp)){
			/** time start before time stop */
			const user = conv.user.storage.user;
			let stopActivity = {id: activity.id, name: activity.name, uuid: activity.uuid, timestamp: timeStop}
	
			await eneact.upload(user, activity, stopActivity, (error) => {			
				if(!error){
					const responseText = `${activity.name} is record from ${start} to ${stop}`;
					conv.ask(responseText);
					db.insertRowsAsStream(conv, responseText, activity.timestamp, timeStop, RECORD_TYPES.TIME_STOP);
				}else{
					const responseText = `Cannot upload ${activity.name}`;
					conv.ask(responseText);
					db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
				}
			});
		}else{
			const responseText = `Start time ${start} must be earlier than end time ${stop}`;
			conv.ask(responseText);
			db.insertRowsAsStream(conv, responseText, activity.timestamp, timeStop, RECORD_TYPES.FALLBACK);

		}
			

	}else{
		const responseText = `I haven't received the record yet. Can you record again?`;
		conv.ask(responseText);
		db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
	}

	conv.user.storage.isFollowup = false;

})

app.intent('fallback', async (conv, params) => {

	const responses = [
		"I didn't get that. Can you say it again?",
		"I missed what you said. What was that?",
		"Sorry, could you say that again?",
		"Sorry, can you say that again?",
		"Can you say that again?",
		"Sorry, I didn't get that. Can you rephrase?",
		"Sorry, what was that?",
		"One more time?",
		"What was that?",
		"Say that one more time?",
		"I didn't get that. Can you repeat?",
		"I missed that, say that again?"
	]

	const responseText = _.sample(responses);
	conv.ask(responseText);
	db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);

});

app.intent('show', async (conv, params) => {
	
	let response = "";
	
	if (Array.isArray(conv.user.storage.activities)){

		if(conv.user.storage.activities.length > 0){
			conv.user.storage.activities.forEach(activity => {
				response += `Activity: ${activity.name}\n\n
				Time: ${moment(activity.timestamp).tz('Asia/Tokyo').format("HH:mm:ss a")}\n\n`
			});;
		}else{
			response = "No activity is recording"
		}
		
	}

	const responseText = response;
	conv.ask(responseText);
	db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.SHOW);
});

app.intent('show_activity_types', async (conv, params) => {
	
	let response = "";

	const activityResult = await db.getActivities();
	
	activityResult.forEach((activity) => {
		response += `${activity.name}\n\n`
	})
	
	const responseText = response;
	conv.ask(responseText);
	db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.SHOW_ACT_TYPE);

});



app.intent('login', async (conv, params) => {
	
	const user = {login: params['email'], password: params['password']};

	await eneact.login(user, (error, userSelf)=> {
		if(!error){

			conv.user.storage.id = userSelf.id;
			conv.user.storage.name = userSelf.name;
			conv.user.storage.email = userSelf.email;
			conv.user.storage.password = userSelf.password;

			const responseText = `Hi! ${conv.user.storage.name} from ${eneact.API}`;
			conv.ask(responseText);
			db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.LOGIN);

		}else{
			const responseText = `${error}`;
			conv.ask(responseText);
			db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.FALLBACK);
		}

	});

});

app.intent('logout', async (conv, params) => {
	conv.user.storage = {};
	const responseText = `You have successfully signed out of your ${eneact.API} account.`;
	conv.ask(responseText);
	db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.LOGIN);

});

app.intent('clear', async (conv, params) => {
	conv.user.storage.activities = [];
	const responseText = `Clear local storage`;
	conv.ask(responseText);
	db.insertRowsAsStream(conv, responseText, null, null, RECORD_TYPES.CLEAR);

});


expressApp.use(bodyParser.urlencoded({ extended: true }))
expressApp.use(bodyParser.json());
expressApp.post('/fulfillment', app);

expressApp.get('/', async (req, res) => {
	// const result = await db.getActivity();
	// res.send(result)
	// console.log(result );

	// let timeStart = "2019-05-21T08:00:00+09:00";
	// console.log("params['time-start'] " + "2019-05-21T08:00:00+09:00");
	// console.log("moment().tz('Asia/Tokyo').format() "  + moment().tz('Asia/Tokyo').format())
	// console.log('momnet ' + moment(timeStart).isSame(moment().tz('Asia/Tokyo').format(), 'day'));
});

expressApp.get('/load_json', (req, res) => {
	db.loadJSONFromGCSAutodetect();
	res.send(`loadJSONFromGCSAutodetect`);
})


const httpServer = http.createServer(expressApp);
const httpsServer = https.createServer(credentials, expressApp);
const httpPort = 80;
// const httpPort = 3000;
const httpsPort = 443;

httpServer.listen(httpPort, () => {
	console.log(`HTTP Server running on port ${httpPort}`);
});

httpsServer.listen(httpsPort, () => {
	console.log(`HTTP Server running on port ${httpsPort}`);
});


