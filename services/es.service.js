"use strict";
const { Client } = require("@elastic/elasticsearch");

const client = new Client({ node: "http://localhost:9200" });

require("array.prototype.flatmap").shim();
/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "es",
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
		createIndex: {
			params: {
				index: "string",
				body: "object|optional",
			},
			async handler(ctx) {
				let body = {
					index: ctx.params.index,
				};
				if (ctx.params.body) {
					body = { ...body, body: ctx.params.body };
				}
				await client.indices.create(body);
			},
		},
		delete: {
			params: {
				index: "string",
				id: "string",
			},
			async handler(ctx) {
				const { index, id } = ctx.params;
				return await client.delete({ index: index, id: id });
			},
		},

		bulk: {
			async handler(ctx) {
				const { index, dataset } = ctx.params;
				const body = dataset.flatMap((doc) => [
					{ index: { _index: index, _id: doc["id"] } },
					doc,
				]);
				return await client.bulk({
					refresh: true,
					body,
				});
			},
		},
		sql: {
			async handler(ctx) {
				return await client.sql.query(ctx.params);
			},
		},
		searchBySystemAndCode: {
			async handler(ctx) {
				const { system, value, index } = ctx.params;
				const {
					hits: { hits },
				} = await client.search({
					index,
					body: {
						query: {
							bool: {
								must: [
									{ match: { "mappings.system": system } },
									{ match: { "mappings.code": value } },
								],
							},
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source.mappings;
				}
			},
		},
		searchByValues: {
			async handler(ctx) {
				const { term, values, index } = ctx.params;
				const {
					hits: { hits },
				} = await client.search({
					index,
					body: {
						query: {
							terms: { [`${term}.keyword`]: values },
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
			},
		},
		search: {
			params: {
				index: "string",
				body: "object",
			},
			async handler(ctx) {
				const {
					hits: { hits },
				} = await client.search({
					index: ctx.params.index,
					body: ctx.params.body,
				});
				return hits.map(({ _source }) => _source);
			},
		},
		get: {
			params: {
				index: "string",
				id: "string",
			},
			async handler(ctx) {
				const { index, id } = ctx.params;
				const { _source } = await client.get({
					index,
					id,
				});
				return _source;
			},
		},
		searchById: {
			params: {
				index: "string",
				id: "string",
			},
			async handler(ctx) {
				const { index, id } = ctx.params;
				const {
					hits: { hits },
				} = await client.search({
					index,
					body: {
						query: {
							match: { "id.keyword": id },
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
				return null;
			},
		},
		searchByPatientId: {
			params: {
				patientId: "string",
			},
			async handler(ctx) {
				const { patientId } = ctx.params;
				const {
					hits: { hits },
				} = await client.search({
					index: "patients",
					body: {
						query: {
							match: { "patientId.keyword": patientId },
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
				return null;
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
