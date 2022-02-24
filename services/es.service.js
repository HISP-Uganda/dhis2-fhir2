"use strict";
const { Client } = require("@elastic/elasticsearch");

const client = new Client({ node: "http://192.168.64.3:9200" });

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
		bulk: {
			async handler(ctx) {
				const { index, dataset, id } = ctx.params;
				const body = dataset.flatMap((doc) => [
					{ index: { _index: index, _id: doc[id] } },
					doc,
				]);
				const { body: bulkResponse } = await client.bulk({
					refresh: true,
					body,
				});
				const errorDocuments = [];
				if (bulkResponse.errors) {
					bulkResponse.items.forEach((action, i) => {
						const operation = Object.keys(action)[0];
						if (action[operation].error) {
							errorDocuments.push({
								status: action[operation].status,
								error: action[operation].error,
								operation: body[i * 2],
								document: body[i * 2 + 1],
							});
						}
					});
				}
				return {
					errorDocuments,
					inserted: dataset.length - errorDocuments.length,
				};
			},
		},
		searchBySystemAndCode: {
			async handler(ctx) {
				const { system, value, index } = ctx.params;
				const {
					body: {
						hits: { hits },
					},
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
					body: {
						hits: { hits },
					},
				} = await client.search({
					index,
					body: {
						query: {
							bool: {
								filter: {
									terms: { [`${term}.keyword`]: values },
								},
							},
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
					body: {
						hits: { hits },
					},
				} = await client.search({
					index: ctx.params.index,
					body: ctx.params.body,
				});
				return hits;
			},
		},
		get: {
			params: {
				index: "string",
				id: "string",
			},
			async handler(ctx) {
				const { index, id } = ctx.params;
				const {
					body: { _source },
				} = await client.get({
					index,
					id,
				});
				return _source;
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
