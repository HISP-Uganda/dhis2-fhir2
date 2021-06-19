"use strict";

const ID_SHORT_NAME = "id,name,shortName,description";

const Fhir = require("fhir").Fhir;

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "fhir",
	/**
	 * Settings
	 */
	settings: {
	},

	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2", "utils"],

	/**
	 * Actions
	 */
	actions: {
		/**
		 * Say a 'Hello' action.
		 *
		 * @returns
		 */
		parse: {
			rest: {
				method: "POST",
				path: "/"
			},
			async handler(ctx) {
				const fhir = new Fhir();
				const { valid, messages } = fhir.validate(ctx.params, {});
				if (valid) {
					const { resourceType } = ctx.params;
					return ctx.call(`utils.${resourceType}`, { [resourceType]: ctx.params });
				}
				return { valid, messages };
			}
		},

		index: {
			rest: {
				method: "POST",
				path: "/index"
			},
			async handler(ctx) {
				const { index, id, ...body } = ctx.params;
				await ctx.call("es.bulk", { index, dataset: [body], id });
				return body;
			}
		},

		synchronize: {
			rest: {
				method: "GET",
				path: "/synchronize"
			},
			async handler(ctx) {
				await Promise.all(["programs", "stages", "concepts", "attributes", "patients", "entities", "organisations"].map((index) => {
					return ctx.call("es.createIndex", { index });
				}));
				const [{ dataElements }, { trackedEntityAttributes }, { trackedEntityTypes }, { programs }, { programStages }] = await Promise.all([
					ctx.call("dhis2.get", { url: "dataElements.json", paging: false, fields: "id,name,shortName,description,valueType", filter: "domainType:eq:TRACKER" }),
					ctx.call("dhis2.get", { url: "trackedEntityAttributes.json", paging: false, fields: "id,name,shortName,description,valueType,unique" }),
					ctx.call("dhis2.get", { url: "trackedEntityTypes.json", paging: false, fields: ID_SHORT_NAME }),
					ctx.call("dhis2.get", { url: "programs.json", paging: false, fields: ID_SHORT_NAME }),
					ctx.call("dhis2.get", { url: "programStages.json", paging: false, fields: "id,name,description,repeatable,program[id,name]" }),
				]);
				const attributes = trackedEntityAttributes.map((attribute) => {
					const mappings = [{
						system: "DHIS2",
						code: attribute.id
					}];
					return { ...attribute, identifier: attribute.unique, type: "", mappings };
				});

				const concepts = dataElements.map((dataElement) => {
					const mappings = [{
						system: "DHIS2",
						code: dataElement.id
					}];
					return { ...dataElement, mappings };
				});

				const entities = trackedEntityTypes.map((trackedEntityType) => {
					const mappings = [{
						system: "DHIS2",
						code: trackedEntityType.id
					}];

					if (String(trackedEntityType.name).toLocaleLowerCase() === "person" || String(trackedEntityType.name).toLocaleLowerCase() === "case") {
						return {
							...trackedEntityType,
							mappings,
							type: "Person"
						};
					}

					return {
						...trackedEntityType,
						mappings
					};
				});

				const progs = programs.map((program) => {
					const mappings = [{
						system: "DHIS2",
						code: program.id
					}];
					return {
						...program,
						mappings,
						type: []
					};
				});

				const stages = programStages.map((programStage) => {
					const mappings = [{
						system: "DHIS2",
						code: programStage.id
					}];
					return {
						...programStage,
						mappings,
					};
				});

				const response = await Promise.all([
					ctx.call("es.bulk", { index: "attributes", dataset: attributes, id: "id" }),
					ctx.call("es.bulk", { index: "concepts", dataset: concepts, id: "id" }),
					ctx.call("es.bulk", { index: "entities", dataset: entities, id: "id" }),
					ctx.call("es.bulk", { index: "programs", dataset: progs, id: "id" }),
					ctx.call("es.bulk", { index: "stages", dataset: stages, id: "id" }),
				]);
				return response;
			}
		},
		concepts: {
			rest: {
				method: "GET",
				path: "/concepts"
			},
			async handler(ctx) {
				const { q, index } = ctx.params;
				return ctx.call("es.search", { index, body: { query: { query_string: { query: q } }, size: 1000 } });
			}
		},
		concept: {
			rest: {
				method: "GET",
				path: "/concepts/:id"
			},
			handler(ctx) {
				return ctx.call("es.get", ctx.params);
			}
		}
	},

	/**
	 * Events
	 */
	events: {

	},

	/**
	 * Methods
	 */
	methods: {
	},

	/**
	 * Service created lifecycle event handler
	 */
	created() {

	},

	/**
	 * Service started lifecycle event handler
	 */
	async started() {

	},

	/**
	 * Service stopped lifecycle event handler
	 */
	async stopped() {

	}
};
