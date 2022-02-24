"use strict";
const Fhir = require("fhir.js");
const { Pool } = require("pg");
const { unionBy, uniqBy } = require("lodash");
const format = require("pg-format");

const pool = new Pool({
	user: "cbs",
	host: "216.104.204.153",
	database: "cbs",
	password: "dsX4mW_*3Yu89yr*",
	port: 5432,
});

const axios = require("axios");

// Initializing the library:
// Creating the database instance:
// const pool = new Pool({
// 	user: "carapai",
// 	host: "localhost",
// 	database: "cbs",
// 	password: "",
// 	port: 5432,
// });

const client = Fhir({
	baseUrl: "http://216.104.204.147:8000",
});

function Inserts(template, data) {
	if (!(this instanceof Inserts)) {
		return new Inserts(template, data);
	}
	this._rawDBType = true;
	this.formatDBType = function () {
		return data.map((d) => "(" + pgp.as.format(template, d) + ")").join(",");
	};
}

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "hapi",
	/**
	 * Settings
	 */
	settings: {},
	/**
	 * Dependencies
	 */
	dependencies: [],

	/**
	 * Actions
	 */
	actions: {
		patients: {
			async handler(ctx) {
				const connection = await pool.connect();
				const {
					data: { entry: patients, link },
				} = await axios.get("http://216.104.204.147:8000/Patient", {
					params: ctx.params,
				});
				let initialPatients = await this.processPatients(patients);
				let next = link.find((l) => l.relation === "next");
				if (next && next.url) {
					do {
						const url = next.url.replace("localhost", "216.104.204.147");
						const {
							data: { entry: patients, link },
						} = await axios.get(url);
						const currentPatients = await this.processPatients(patients);
						initialPatients = [...initialPatients, ...currentPatients];
						next = link.find((l) => l.relation === "next");
					} while (!!next);
				}
				initialPatients = uniqBy(initialPatients, (x) => x[0]);
				const response = await connection.query(
					format(
						"INSERT INTO staging_patient (case_id,sex,date_of_birth,deceased,date_of_death) VALUES %L",
						initialPatients
					)
				);
				connection.release();
				return response;
			},
		},
		obs: {
			async handler(ctx) {
				const connection = await pool.connect();
				const {
					data: { entry: observations, link },
				} = await axios.get("http://216.104.204.147:8000/Observation", {
					params: ctx.params,
				});
				let initialObs = await this.insertObs(observations);
				let next = link.find((l) => l.relation === "next");
				if (next && next.url) {
					do {
						const url = next.url.replace("localhost", "216.104.204.147");
						const {
							data: { entry: observations, link },
						} = await axios.get(url);
						const currentObs = await this.insertObs(observations);
						initialObs = [...initialObs, ...currentObs];
						next = link.find((l) => l.relation === "next");
					} while (!!next);
				}
				initialObs = uniqBy(initialObs, (x) => `${x[0]}${x[1]}`);
				const response = await connection.query(
					format(
						"INSERT INTO staging_patient_encounters(case_id,encounter_date,facility_id,encounter_id,obs_uuid,obs_name,obs_value) VALUES %L",
						initialObs
					)
				);
				connection.release();
				return response;
			},
		},
	},

	/**
	 * Events
	 */
	events: {},

	/**
	 * Methods
	 */
	methods: {
		async insertObs(observations) {
			// const connection = await pool.connect();
			const obs = [];
			if (observations && observations.length > 0) {
				for (const bundle of observations) {
					const {
						valueQuantity,
						valueCodeableConcept,
						valueString,
						valueBoolean,
						valueInteger,
						valueTime,
						valueDateTime,
						encounter: { reference: ref },
						effectiveDateTime,
						code: {
							coding: [{ display: obs_name, code }],
						},
						subject: { reference },
					} = bundle.resource;

					let realValue =
						valueString ||
						valueBoolean ||
						valueInteger ||
						valueTime ||
						valueDateTime;

					if (valueQuantity) {
						realValue = valueQuantity.value;
					}
					if (valueCodeableConcept) {
						const {
							coding: [{ display }],
						} = valueCodeableConcept;
						realValue = display;
					}
					const patient = String(reference).split("/")[1];
					const encounterId = String(ref).split("/")[1];

					obs.push([
						patient,
						effectiveDateTime,
						"dim1yW6CLFU",
						encounterId,
						code,
						obs_name,
						realValue,
					]);
				}
			}
			return obs;
		},
		async processPatients(patients) {
			const processedPatient = [];
			for (const bundle of patients) {
				let patientInfo = {
					case_id: bundle.resource.id,
					sex: bundle.resource.gender,
					date_of_birth: bundle.resource.birthDate,
					deceased: bundle.resource.deceasedBoolean,
					date_of_death: bundle.resource.deceasedDate || null,
				};
				if (
					patientInfo.date_of_birth &&
					patientInfo.date_of_birth.length === 4
				) {
					patientInfo = {
						...patientInfo,
						date_of_birth: `${patientInfo.date_of_birth}-01-01`,
					};
				}
				if (
					patientInfo.case_id &&
					patientInfo.date_of_birth &&
					patientInfo.date_of_birth.length === 10 &&
					patientInfo.sex
				) {
					processedPatient.push([
						patientInfo.case_id,
						patientInfo.sex,
						patientInfo.date_of_birth,
						patientInfo.deceased,
						patientInfo.date_of_death,
					]);
				}
			}

			return processedPatient;
		},

		async processEncounter(encounters, obsQuery) {
			const connection = await pool.connect();
			const encounterIds = [];
			let foundEncounter = {};
			if (encounters && encounters.length > 0) {
				let facility = "CPX";
				for (const bundle of encounters) {
					encounterIds.push(bundle.resource.id);

					if (bundle.resource?.serviceProvider?.reference) {
						facility = String(bundle.resource.serviceProvider.reference).split(
							"/"
						)[1];
					}
					foundEncounter = {
						...foundEncounter,
						[bundle.resource.id]: {
							start: bundle.resource.period?.start,
							facility,
						},
					};
				}
				const {
					data: { entry: observations, link },
				} = await client.search({
					type: "Observation",
					query: {
						encounter: encounterIds.join(","),
						...obsQuery,
					},
				});
				const allObs = this.insertObs(observations, foundEncounter);
				let next = link.find((l) => l.relation === "next");
				if (next && next.url) {
					do {
						const url = next.url.replace("localhost", "216.104.204.147");
						const {
							data: { entry: obs, link },
						} = await axios.get(url);
						const currentObs = await this.insertObs(obs, foundEncounter);
						allObs = [...allObs, ...currentObs];
						next = link.find((l) => l.relation === "next");
					} while (!!next);
				}
				connection.release();
				return allObs;
			}
		},
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {},
};
