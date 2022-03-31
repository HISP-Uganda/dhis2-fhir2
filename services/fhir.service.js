"use strict";

const ID_SHORT_NAME = "id,name,shortName,description";
const csv = require("csvtojson");

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */

module.exports = {
	name: "fhir",
	/**
	 * Settings
	 */
	settings: {},

	/**
	 * Dependencies
	 */
	dependencies: ["es", "dhis2", "utils", "hapi"],

	/**
	 * Actions
	 */
	actions: {
		/**
		 *
		 * @returns
		 */
		parse: {
			rest: {
				method: "POST",
				path: "/",
			},
			async handler(ctx) {
				// const fhir = new Fhir();
				// const { valid, messages } = fhir.validate(ctx.params, {});
				// if (valid) {
				const { resourceType } = ctx.params;
				if (resourceType === "Bundle") {
					let responses = [];
					// const patients = ctx.params.entry.filter(
					// 	(r) => r.resource.resourceType === "Patient"
					// );
					// const eocs = ctx.params.entry.filter(
					// 	(r) => r.resource.resourceType === "EpisodeOfCare"
					// );
					const encounters = ctx.params.entry.filter(
						(r) => r.resource.resourceType === "Encounter"
					);
					// const observations = ctx.params.entry.filter(
					// 	(r) => r.resource.resourceType === "Observation"
					// );
					// console.log(patients);
					// for (const p of patients) {
					// 	const response = await ctx.call(`utils.Patient`, {
					// 		["Patient"]: p.resource,
					// 	});
					// 	responses = [...responses, response];
					// }
					// for (const eoc of eocs) {
					// 	const response = await ctx.call(`utils.EpisodeOfCare`, {
					// 		["EpisodeOfCare"]: eoc.resource,
					// 	});
					// 	responses = [...responses, response];
					// }
					for (const encounter of encounters) {
						const response = await ctx.call(`utils.Encounter`, {
							["Encounter"]: encounter.resource,
						});
						responses = [...responses, response];
					}
					// for (const obs of observations) {
					// 	const response = await ctx.call(`utils.Observation`, {
					// 		["Observation"]: obs.resource,
					// 	});
					// 	responses = [...responses, response];
					// }
					return responses;
				}
				return ctx.call(`utils.${resourceType}`, {
					[resourceType]: ctx.params,
				});
				// }
				// return { valid, messages };
			},
		},

		index: {
			rest: {
				method: "POST",
				path: "/index",
			},
			async handler(ctx) {
				const { index, id, ...body } = ctx.params;
				await ctx.call("es.bulk", { index, dataset: [body], id });
				return body;
			},
		},

		obs_sync: {
			rest: {
				method: "GET",
				path: "/obs_sync",
			},
			async handler(ctx) {
				const obs = await csv().fromFile(
					"/Users/carapai/projects/dhis2-fhir/services/obs.csv"
				);

				const processedObs = obs
					.filter((o) => !!o.id)
					.map((ob) => {
						const mappings = [
							{
								system: "UgandaEMR",
								code: ob.Code,
							},
							{
								system: "DHIS2",
								code: ob.id,
							},
						];
						return {
							id: ob.id,
							name: ob.name,
							code: ob.code,
							mappings,
						};
					});
				const response = await ctx.call("es.bulk", {
					index: "obs",
					dataset: processedObs,
					id: "id",
				});
				return response;
			},
		},

		ou_sync: {
			rest: {
				method: "GET",
				path: "/ou_sync",
			},
			async handler(ctx) {
				const { organisationUnits } = await ctx.call("dhis2.get", {
					url: "organisationUnits.json",
					level: 5,
					fields: "id,name,shortName,description",
					paging: false,
				});

				const ous = organisationUnits.map((ou) => {
					const mappings = [
						{
							system: "DHIS2",
							code: ou.id,
						},
					];
					return {
						...ou,
						mappings,
					};
				});
				return ctx.call("es.bulk", {
					index: "organisations",
					dataset: ous,
					id: "id",
				});
			},
		},

		synchronize: {
			rest: {
				method: "GET",
				path: "/synchronize",
			},
			async handler(ctx) {
				await Promise.all(
					[
						"programs",
						"stages",
						"concepts",
						"attributes",
						"patients",
						"entities",
						"organisations",
					].map((index) => {
						return ctx.call("es.createIndex", { index });
					})
				);
				const [
					{ dataElements },
					{ trackedEntityAttributes },
					{ trackedEntityTypes },
					{ programs },
					{ programStages },
				] = await Promise.all([
					ctx.call("dhis2.get", {
						url: "dataElements.json",
						paging: false,
						fields: "id,name,shortName,description,valueType",
						filter: "domainType:eq:TRACKER",
					}),
					ctx.call("dhis2.get", {
						url: "trackedEntityAttributes.json",
						paging: false,
						fields: "id,name,shortName,description,valueType,unique",
					}),
					ctx.call("dhis2.get", {
						url: "trackedEntityTypes.json",
						paging: false,
						fields: ID_SHORT_NAME,
					}),
					ctx.call("dhis2.get", {
						url: "programs.json",
						paging: false,
						fields: ID_SHORT_NAME,
					}),
					ctx.call("dhis2.get", {
						url: "programStages.json",
						paging: false,
						fields: "id,name,description,repeatable,program[id,name]",
					}),
				]);
				const attributes = trackedEntityAttributes.map((attribute) => {
					const mappings = [
						{
							system: "DHIS2",
							code: attribute.id,
						},
					];
					return {
						...attribute,
						identifier: attribute.unique,
						type: "",
						mappings,
					};
				});

				const concepts = dataElements.map((dataElement) => {
					const mappings = [
						{
							system: "DHIS2",
							code: dataElement.id,
						},
					];
					return { ...dataElement, mappings };
				});

				const entities = trackedEntityTypes.map((trackedEntityType) => {
					const mappings = [
						{
							system: "DHIS2",
							code: trackedEntityType.id,
						},
					];

					if (
						String(trackedEntityType.name).toLocaleLowerCase() === "person" ||
						String(trackedEntityType.name).toLocaleLowerCase() === "case"
					) {
						return {
							...trackedEntityType,
							mappings,
							type: "Person",
						};
					}

					return {
						...trackedEntityType,
						mappings,
					};
				});

				const progs = programs.map((program) => {
					const mappings = [
						{
							system: "DHIS2",
							code: program.id,
						},
					];
					return {
						...program,
						mappings,
						type: [],
					};
				});

				const stages = programStages.map((programStage) => {
					const mappings = [
						{
							system: "DHIS2",
							code: programStage.id,
						},
					];
					return {
						...programStage,
						mappings,
					};
				});

				const response = await Promise.all([
					ctx.call("es.bulk", {
						index: "attributes",
						dataset: attributes,
						id: "id",
					}),
					ctx.call("es.bulk", {
						index: "concepts",
						dataset: concepts,
						id: "id",
					}),
					ctx.call("es.bulk", {
						index: "entities",
						dataset: entities,
						id: "id",
					}),
					ctx.call("es.bulk", { index: "programs", dataset: progs, id: "id" }),
					ctx.call("es.bulk", { index: "stages", dataset: stages, id: "id" }),
				]);
				return response;
			},
		},
		concepts: {
			rest: {
				method: "GET",
				path: "/concepts",
			},
			async handler(ctx) {
				const { q, index } = ctx.params;
				return ctx.call("es.search", {
					index,
					body: { query: { query_string: { query: q } }, size: 1000 },
				});
			},
		},
		concept: {
			rest: {
				method: "GET",
				path: "/concepts/:id",
			},
			handler(ctx) {
				return ctx.call("es.get", ctx.params);
			},
		},
		patients: {
			rest: {
				method: "GET",
				path: "/hapi/patients",
			},
			handler(ctx) {
				return ctx.call("hapi.patients", ctx.params);
			},
		},
		obs: {
			rest: {
				method: "GET",
				path: "/hapi/obs",
			},
			handler(ctx) {
				return ctx.call("hapi.obs", ctx.params);
			},
		},
		encounters: {
			rest: {
				method: "GET",
				path: "/hapi/encounters",
			},
			handler(ctx) {
				return ctx.call("hapi.encounters", ctx.params);
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
