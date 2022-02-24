"use strict";
const Cron = require("moleculer-cron");
const Fhir = require("fhir.js");
const { fromPairs } = require("lodash");
const subMinutes = require("date-fns/subMinutes");

const client = Fhir({
	baseUrl: "http://216.104.204.147:8000",
});

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "schedule",

	mixins: [Cron],
	/**
	 * Settings
	 */
	settings: {},

	crons: [
		{
			name: "fhir",
			cronTime: "* * * * *",
			onTick: async function () {
				const dateTo = new Date();
				const dateFrom = subMinutes(dateTo, 1);
				// const patients = await this.getLocalService(
				// 	"schedule"
				// ).actions.patients();
				// const { data } = await client.search({ type: "Patient" });
				// const profileFacts = data.entry.map((bundle) => {
				// 	const identifiers = fromPairs(
				// 		bundle.resource.identifier?.map((identifier) => [
				// 			identifier.type?.text || "uid",
				// 			identifier.value,
				// 		])
				// 	);

				// 	return {
				// 		id: bundle.resource.id,
				// 		...identifiers,
				// 		gender: bundle.resource.gender,
				// 		birthDate: bundle.resource.birthDate,
				// 		maritalStatus: bundle.resource.maritalStatus,
				// 		address: bundle.resource.address
				// 			?.map((address) => address.country)
				// 			.join(","),
				// 	};
				// });

				// console.log(profileFacts);

				// const { data: obs } = await client.search({ type: "Observation" });
			},
			runOnInit: function () {
				console.log("fhir scheduler is created");
			},
		},
	],

	/**
	 * Dependencies
	 */
	dependencies: ["hapi"],

	/**
	 * Actions
	 */
	actions: {
		baseline: {
			async handler(ctx) {
				return ctx.call("hapi.patients", {code:''});
			},
		},
		obs: {
			async handler(ctx) {
				return ctx.call("hapi.obs", ctx.params);
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
	methods: {},

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
