"use strict";
const { Client } = require("@elastic/elasticsearch");
const client = new Client({ node: "http://localhost:9200" });

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
		searchAll: {
			async handler(ctx) {
				const { index } = ctx.params;
				const {
					hits: { hits },
				} = await client.search({
					index,
					body: {
						query: {
							match_all: {},
						},
					},
				});
				return hits.map(({ _source }) => _source);
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
				const record = await client.get(ctx.params);
				if (record) {
					return record._source;
				}
				return { message: "Unknown record" };
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
		bulk: {
			async handler(ctx) {
				const { index, dataset } = ctx.params;
				const body = dataset.flatMap((doc) => [
					{ index: { _index: index, _id: doc["id"] } },
					doc,
				]);

				const response = await client.bulk({
					refresh: true,
					body,
				});
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
				const {
					hits: { hits },
				} = await client.search(ctx.params);
				return hits.map(({ _source }) => _source);
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
