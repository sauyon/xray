

// textutil -convert txt *

var parse = require('csv-parse/lib/sync'),
	csvstr = require('csv-stringify'),
	fs = require('fs'),
	promise = require('bluebird'),
	_ = require('lodash'),
	headers,
	qualmode,
	qs = require('querystring'),
	config = JSON.parse(fs.readFileSync('./munge-config.json')),
	cutils = require('./client-utils'),
	round_re = /ROUND\W*(\d+)/,
	exit_re = /exit\W*\>|exit interview|exit questions|exit survey/i,
	enters = {},
	exits = {};

var load_transcript = (fname) => {
	var text = fs.readFileSync(fname).toString(),
		first_sep_match = text.match(round_re),
		fidx = first_sep_match && text.indexOf(first_sep_match[0]),
		introtext = fidx && text.slice(0,fidx).split('\n').filter((x) => x.length > 0),
		rtext = fidx && text.slice(fidx).split('\n').filter((x) => x.length > 0),
		exitmatch = text.slice(fidx).match(exit_re),
		exittext = exitmatch && text.slice(fidx).slice(text.slice(fidx).indexOf(exitmatch[0])),
		rounds = [],
		cur_r = first_sep_match && parseInt(first_sep_match[1])-1,
		done;

	if (!first_sep_match) { 
		console.error("No separator found in ", fname, " skipping");
		return;
	}

	rtext.map((line) => {
		if (done) { return; }

		var rT = rounds[cur_r] || '',
			m = line.match(round_re),
			e = line.match(exit_re);

		if (e) { done = true; return; }
		if (m) {
			// incr and skip
			cur_r = parseInt(m[1])-1;
			console.info('next round ', fname, ' r ', cur_r);			
			return;
		}
		rounds[cur_r] = rT + line;
	});

	if (introtext) { 
		console.info("INTRO :: :: :: :: ", fname, introtext);
	 	rounds.enter = introtext;  
	}
	if (exittext) { 
		console.info("EXIT :: :: :: :: ", fname, exittext);		
		rounds.exit = exittext;  
	}
	return rounds;
}, 	
load_transcripts = () => {
	var srcdir = config.transcripts;
	return fs.readdirSync(srcdir)
		.filter((fname) => fname.indexOf('.txt') >= 0)
		.reduce((d,fname) => 
			{ 
				var ltr = load_transcript([srcdir,fname].join('/')),
					p = fname.slice(0,-'.txt'.length);
				d[p] = ltr;

				if (ltr && ltr.enter) { 
					// console.log('????????????????? enter ', p); 
					enters[p] = ltr.enter;	
				}
				if (ltr && ltr.exit) { 
					// console.log('????????????????? exit ', p); 
					exits[p] = ltr.exit;	
				}
				return d;
			}, {});
},
load_client = () => {
	var pitypes = JSON.parse(fs.readFileSync('../mitm_out/pi_by_host.json')),
		hosts = JSON.parse(fs.readFileSync('../mitm_out/host_by_app.json')),
		details =  JSON.parse(fs.readFileSync('../mitm_out/company_details.json')),
		allData = JSON.parse(fs.readFileSync('../mitm_out/data_all.json')),
		getAppCompany = (app) => { 
			console.log('app ', app); //debug
			return allData.filter((x) => x.app === app)[0].company;
		};
		
	return { 
		getHosts:(app) => { 
			var data = allData.filter((x) => x.app === app),
				hTh = cutils.makeHTH(data),
				hu = _.uniq(_.keys(hosts[app]).map((h) => hTh[h]));
			return hu;
		},
		getCompanies:(app) => { 
			var c2pi = cutils.makeCompany2pi(app, allData.filter((x) => x.app === app), hosts, pitypes, 0);
			return _.keys(c2pi);
		},
		getCategories:(app) => { 
			var c2pi = cutils.makeCompany2pi(app, allData.filter((x) => x.app === app), hosts, pitypes, 0),
				appcompany = getAppCompany(app),
				cat2c2pi = cutils.makeCategories(appcompany, details, c2pi);
			return _.keys(cat2c2pi).sort().map((cat) => [cat,_.keys(cat2c2pi[cat]).length].join(':'));
		},
		getMarketing:(app) => { 
			var c2pi = cutils.makeCompany2pi(app, allData.filter((x) => x.app === app), hosts, pitypes, 0),
				appcompany = getAppCompany(app),
				cat2c2pi = cutils.makeCategories(appcompany, details, c2pi);
			return _.keys(cat2c2pi.marketing);
		},
		getCatCompanies:(app, cat) => { 
			var c2pi = cutils.makeCompany2pi(app, allData.filter((x) => x.app === app), hosts, pitypes, 0),
				appcompany = getAppCompany(app),
				cat2c2pi = cutils.makeCategories(appcompany, details, c2pi);
			return _.keys(cat2c2pi[cat]);
		},

		getPermissions:(app) => { 
			var c2pi = cutils.makeCompany2pi(app, allData.filter((x) => x.app === app), hosts, pitypes, 0),
				appcompany = getAppCompany(app),
				cat2c2pi = cutils.makeCategories(appcompany, details, c2pi),
				pits =  _(c2pi).values().flatten().uniq().value(),
				pi2c = pits.reduce((red, pit) => {
					red[pit] = _.keys(c2pi).filter((c) => c2pi[c].indexOf(pit) >= 0).length;
					return red;
				}, {});
			return pi2c;
		},
		getUnique:(app) => {
			// todo pdci things
		}
	};
},
load_rounds = () => {
	// loads data files in batch
	var srcdir = config.rounds;
	return fs.readdirSync(srcdir)
		.filter((fname) => fname.indexOf('.json') >= 0)
		.reduce((d,fname) => 
			{ 
				var filen = [srcdir,fname].join('/'),
					filed = JSON.parse(fs.readFileSync(filen).toString()),
					pid = filed.participant,
					rounds = filed;

				if (pid !== fname.slice(0,-'.json'.length)) { 
					console.warn('file doestn match participant id ', pid, fname);
				}
				d[pid] = rounds;
				return d;
			}, 
			{});
}, gen_out = (transcripts, rounds, fakeapps) => {
	// get fields x
	var client = load_client(),
		field_names = [
			'id',
			'round',
			'participant',
			'pdciApps',			
			'npdci',	
			'condition',
			'domain',
			'app_a',
			'type_a',
			'app_b',			
			'type_b',
			'chosen',
			'type_chosen',
			'elapsed_secs',			
			'confidence',
			'hosts_a',
			'n_hosts_a',
			'hosts_b',
			'n_hosts_b',			
			'companies_a',
			'n_companies_a',			
			'companies_b',
			'n_companies_b',
			'n_apppub_a',
			'n_apppub_b',
			'n_appfn_a',
			'n_appfn_b',
			'n_marketing_a',
			'n_marketing_b',
			'n_usagetr_a',
			'n_usagetr_b',
			'n_payments_a',
			'n_payments_b',
			'n_security_a',
			'n_security_b',
			'n_other_a',
			'n_other_b',
			// 'categories_a',
			// 'categories_b',
			'perms_a',
			'perms_b',
			'perms_location_a',
			'perms_location_b',
			'perms_coarseloc_a',
			'perms_coarseloc_b',
			'perms_device_id_a',
			'perms_device_id_b',
			'perms_device_chr_a',
			'perms_device_chr_b',
			'perms_user_details_a',
			'perms_user_details_b',
			'thinkaloud'
		],
		field_values = [
			(rounds, r, ri) => [rounds.participant,''+ri].join('-'), // unique id
			(rounds, r, ri) => ri+1, // round
			(rounds, r, ri) => rounds.participant, // participant
			(rounds, r, ri) => rounds.pdciApps.join(';'), // pdci apps
			(rounds, r, ri) => rounds.pdciApps.length, // npdci
			(rounds, r, ri) => r.cond, // condition
			(rounds, r, ri) => r.domain, // domain
			(rounds, r, ri) => r.a, // appa
			(rounds, r, ri) => fakeapps[r.a], // typea
			(rounds, r, ri) => r.b, // appb
			(rounds, r, ri) => fakeapps[r.b], //typeb
			(rounds, r, ri) => r.result && r.result.chosen || '~', // resultchosen
			(rounds, r, ri) => r.result && fakeapps[r.result.chosen] || '~', // typechosen
			(rounds, r, ri) => r.result && Math.round(r.result.elapsed/1000.0) || '~', // elapsed
			(rounds, r, ri) => r.result && parseInt(r.result.confidence.slice('likert'.length+1)) || '~', // elapsed

			// CLIENT features
			(rounds, r, ri) => client.getHosts(r.a).join(';'),
			(rounds, r, ri) => client.getHosts(r.a).length,
			(rounds, r, ri) => client.getHosts(r.b).join(';'),
			(rounds, r, ri) => client.getHosts(r.b).length,

			(rounds, r, ri) => client.getCompanies(r.a).join(';'),
			(rounds, r, ri) => client.getCompanies(r.a).length,
			(rounds, r, ri) => client.getCompanies(r.b).join(';'),
			(rounds, r, ri) => client.getCompanies(r.b).length,

			(rounds, r, ri) => client.getCatCompanies(r.a,'app-publisher').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'app-publisher').length,
			(rounds, r, ri) => client.getCatCompanies(r.a,'app-functionality').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'app-functionality').length,
			(rounds, r, ri) => client.getCatCompanies(r.a,'marketing').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'marketing').length,
			(rounds, r, ri) => client.getCatCompanies(r.a,'usage tracking').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'usage tracking').length,
			(rounds, r, ri) => client.getCatCompanies(r.a,'payments').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'payments').length,			
			(rounds, r, ri) => client.getCatCompanies(r.a,'security').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'security').length,
			(rounds, r, ri) => client.getCatCompanies(r.a,'other').length,
			(rounds, r, ri) => client.getCatCompanies(r.b,'other').length,


			// (rounds, r, ri) => client.getCategories(r.a).join(';'),
			// (rounds, r, ri) => client.getCategories(r.b).join(';'),
			(rounds, r, ri) => _.keys(client.getPermissions(r.a)).length, // join(';'),
			(rounds, r, ri) => _.keys(client.getPermissions(r.b)).length, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.a)['USER_LOCATION'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.b)['USER_LOCATION'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.a)['USER_LOCATION_COARSE'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.b)['USER_LOCATION_COARSE'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.a)['DEVICE_ID'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.b)['DEVICE_ID'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.a)['DEVICE_SOFT'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.b)['DEVICE_SOFT'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.a)['USER_PERSONAL_DETAILS'] || 0, // join(';'),
			(rounds, r, ri) => client.getPermissions(r.b)['USER_PERSONAL_DETAILS'] || 0, // join(';'),

			(rounds, r, ri) => transcripts[rounds.participant] && transcripts[rounds.participant][ri] || '~'
		];


	if (qualmode) { 
		// subset for qual
		var fn = [field_names[0],field_names[field_names.indexOf('participant')],field_names[field_names.indexOf('round')],field_names[field_names.indexOf('condition')],field_names[field_names.indexOf('thinkaloud')]],	
			fv = [field_values[0],field_values[field_names.indexOf('participant')],field_values[field_names.indexOf('round')],field_values[field_names.indexOf('condition')], field_values[field_names.indexOf('thinkaloud')]];
		field_names = fn;
		field_values = fv;
		console.info('field names ', field_names);		
		console.info('field values ', field_values);		
	}

	var rows = [field_names].concat(_.flatten(_.keys(rounds).map((participant) => {
		var rdata = rounds[participant];
		return _(rdata.rounds).map((r,i) => field_values.map((f) => {
			console.info(rdata.participant, i, field_names[field_values.indexOf(f)], f(rdata,r,i));
			return f(rdata,r,i);
		})).value();
	})));

	// add intro and exit
	if (qualmode) { 
		_.keys(rounds).map((participant) => {
			if (enters[participant]) { 
				console.info(":: CONCATENATING !!!!!!!!!!!! ENTER :: ", participant);
				rows = rows.concat([[participant+"-enter", participant,'enter','',enters[participant]]]);
			}
			if (exits[participant]) { 
				console.info(":: CONCATENATING !!!!!!!!!!!!!!! EXIT :: ", participant);
				rows = rows.concat([[participant+"-exit", participant,'exit','',exits[participant]]]);
			}
		});
	}

	return new Promise((acc, rej) => {
		csvstr(rows, (err, output) => {
			if (!err) { return acc(output); }
			console.error("Error ", err);
			rej(err);
		});
	});
}, loadCSV = (fname) => {
	var text = 	fs.readFileSync(fname).toString();
	console.log("Parsing file ", fname, "(", text.length, ")");
	var data = parse(text, {max_limit_on_data_read:9999999999});
	headers = data[0];
	data = data.slice(1);
	data = data.map((x) => _.zipObject(headers,x));
	return data;
}, app2type = (apparr) => {
	// simply takes array [ { "App type code":'', "fake name": .. } ]
	// -> { fake name : app type code }

	return apparr.reduce((d, app) => {
		d[app['fake name']] = app['App type code'];
		return d;
	}, {});
},
main = (mode) => {
	var ts = load_transcripts(), 
		rs = load_rounds(),
		fakeapps = app2type(loadCSV(config.fakeapps)),
		fout = config.out + (qualmode ? '-qual.csv' : '');

	if (!fout) { 
		console.error("No output directory specified, please set out_dir in qual-chop-config");
		return;
	}

	console.info('loaded ', _.keys(ts).length, ' transcripts', _.keys(ts));
	console.info('loaded ', _.keys(rs).length, ' rounds ', _.keys(rs));

	console.info('fake apps ', fakeapps);


	gen_out(ts, rs, fakeapps).then((output) => {
		console.info("Writing output ", fout, fout.length);
		fs.writeFileSync(fout, output);
		console.log('done.');
	}).catch((err) => {
		console.error("Error, terminating ", err);
	});
};

if (require.main === module) { 
	if (process.argv[2] === 'qual') { 
		console.info('qualmode on');
		qualmode=true;
	}
	main(); 
}