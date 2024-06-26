"use strict";

const axios = require("axios");
const instance = axios.create({
	baseURL: process.env.DHIS2_URL,
	auth: {
		username: process.env.DHIS2_USERNAME,
		password: process.env.DHIS2_PASSWORD,
	},
});
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "dhis2",
	/**
	 *
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
		get: {
			async handler(ctx) {
				const { url, ...params } = ctx.params;
				const { data } = await instance.get(url, {
					params,
				});
				return data;
			},
		},
		post: {
			async handler(ctx) {
				const { url, ...body } = ctx.params;
				const { data } = await instance.post(url, body);
				return data;
			},
		},
		put: {
			async handler(ctx) {
				const { url, ...body } = ctx.params;
				const { data } = await instance.put(url, body);
				return data;
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
