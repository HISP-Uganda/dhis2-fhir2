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
	dependencies: ["es", "dhis2", "resources"],

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
				const { resourceType } = ctx.params;
				if (resourceType === "Bundle") {
					const patients = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "Patient"
					);
					const eocs = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "EpisodeOfCare"
					);
					const encounters = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "Encounter"
					);

					const observations = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "Observation"
					);
					const processedPatients = await Promise.all(
						patients.map((p) =>
							ctx.call("resources.Patient", {
								["Patient"]: p.resource,
							})
						)
					);

					const processedEpisodesOfCare = await Promise.all(
						eocs.map((eoc) =>
							ctx.call(`resources.EpisodeOfCare`, {
								["EpisodeOfCare"]: eoc.resource,
							})
						)
					);

					const processedEncounters = await Promise.all(
						encounters.map((encounter) =>
							ctx.call(`resources.Encounter`, {
								["Encounter"]: encounter.resource,
							})
						)
					);

					const processedObservations = await Promise.all(
						observations.map((obs) =>
							ctx.call(`resources.Observation`, {
								["Observation"]: obs.resource,
							})
						)
					);
					return {
						entry: [
							...processedPatients,
							...processedEpisodesOfCare,
							...processedEncounters,
							...processedObservations,
						],
					};
				}
				return ctx.call(`resources.${resourceType}`, {
					[resourceType]: ctx.params,
				});
			},
		},
		search: {
			rest: {
				method: "POST",
				path: "/search",
			},
			async handler(ctx) {
				const { index, ...body } = ctx.params;
				return await ctx.call("es.search", {
					index,
					body,
				});
			},
		},
		delete: {
			rest: {
				method: "GET",
				path: "/delete",
			},
			async handler(ctx) {
				const { index, id } = ctx.params;
				return await ctx.call("es.delete", {
					index,
					id,
				});
			},
		},
		index: {
			rest: {
				method: "POST",
				path: "/index",
			},
			async handler(ctx) {
				const { index, idField, ...body } = ctx.params;
				await ctx.call("es.bulk", { index, dataset: [body], idField });
				return body;
			},
		},
		option_sync: {
			rest: {
				method: "POST",
				path: "/option_sync",
			},
			async handler(ctx) {
				const processedObs = ctx.params.options
					.filter((o) => !!o.code && !!o.ugandaEmr)
					.map((ob) => {
						const mappings = [
							{
								system: "UgandaEMR",
								code: ob.ugandaEmr,
							},
							{
								system: "http://tbl-ecbss.go.ug/options",
								code: ob.code,
							},
						];
						return {
							id: `${ob.optionSet}${ob.code}`,
							name: ob.name,
							code: ob.code,
							mappings,
						};
					});
				const response = await ctx.call("es.bulk", {
					index: "concepts",
					dataset: processedObs,
					idField: "id",
				});
				return response;
			},
		},
		obs_sync: {
			rest: {
				method: "POST",
				path: "/obs_sync",
			},
			async handler(ctx) {
				const processedObs = ctx.params.obs
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
					index: "concepts",
					dataset: processedObs,
					idField: "id",
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
					idField: "id",
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
						idField: "id",
					}),
					ctx.call("es.bulk", {
						index: "concepts",
						dataset: concepts,
						idField: "id",
					}),
					ctx.call("es.bulk", {
						index: "entities",
						dataset: entities,
						idField: "id",
					}),
					ctx.call("es.bulk", {
						index: "programs",
						dataset: progs,
						idField: "id",
					}),
					ctx.call("es.bulk", {
						index: "stages",
						dataset: stages,
						idField: "id",
					}),
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
					body: {
						query: {
							multi_match: {
								query: q,
								fields: ["name", "id"],
							},
						},
						size: 1000,
					},
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
