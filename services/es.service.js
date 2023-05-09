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
				return await client.indices.create(body);
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
		sql: {
			async handler(ctx) {
				return await client.sql.query(ctx.params);
			},
		},
		delete: {
			async handler(ctx) {
				return await client.deleteByQuery(ctx.params);
			},
		},
		index: {
			async handler(ctx) {
				return await client.index(ctx.params);
			},
		},
		get: {
			async handler(ctx) {
				return await client.get(ctx.params);
			},
		},
		bulk: {
			async handler(ctx) {
				const { index, dataset, id } = ctx.params;
				const body = flatMap(dataset, (doc) => [
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
							terms: { [`${term}.keyword`]: values },
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
			},
		},
		searchTrackedEntityInstance: {
			async handler(ctx) {
				const { trackedEntityInstance, index } = ctx.params;
				const {
					body: {
						hits: { hits },
					},
				} = await client.search({
					index,
					body: {
						query: {
							bool: {
								should: [
									{
										term: {
											"trackedEntityInstance.keyword": trackedEntityInstance,
										},
									},
									{ term: { "id.keyword": trackedEntityInstance } },
								],
							},
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
				return {
					message: "Record not found or could not be validated",
				};
			},
		},
		searchByIdentifier: {
			async handler(ctx) {
				const { identifier, index } = ctx.params;
				const {
					body: {
						hits: { hits },
					},
				} = await client.search({
					index,
					body: {
						query: {
							term: { "Ewi7FUfcHAD.keyword": identifier },
						},
					},
				});
				if (hits.length > 0) {
					return hits[0]._source;
				}
				return { message: "Record not found or could not be validated" };
			},
		},
		search: {
			params: {
				index: "string",
				body: "object",
			},
			async handler(ctx) {
				const { body } = await client.search(ctx.params);
				return body;
			},
		},
		search2: {
			params: {
				index: "string",
				body: "object",
			},
			async handler(ctx) {
				const {
					body: {
						hits: { hits },
					},
				} = await client.search(ctx.params);
				return hits.map((h) => h._source);
			},
		},
		scroll: {
			params: {
				index: "string",
				body: "object",
			},
			async handler(ctx) {
				const scrollSearch = client.helpers.scrollSearch(ctx.params);
				let documents = [];
				for await (const result of scrollSearch) {
					documents = [...documents, ...result.documents];
				}
				return documents;
			},
		},
		aggregations: {
			params: {
				index: "string",
				body: "object",
			},
			async handler(ctx) {
				const {
					body: { aggregations },
				} = await client.search(ctx.params);
				return aggregations;
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
