"use strict";
const ID_SHORT_NAME = "id,name,shortName,description";

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
					let encounters = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "Encounter"
					);
					let observations = ctx.params.entry.filter(
						(r) => r.resource && r.resource.resourceType === "Observation"
					);
					const obsGroups = observations.flatMap((obs) => {
						if (obs.resource.hasMember && obs.resource.hasMember.length > 0) {
							return obs.resource.hasMember.flatMap(({ reference }) => {
								const id = String(reference).replace("Observation/", "");
								const currentObs = observations.find(
									(o) => o.resource.id === id
								);
								if (currentObs) {
									return {
										resource: {
											...currentObs.resource,
											encounter: { reference: `Encounter/${obs.resource.id}` },
										},
									};
								}
								return [];
							});
						}
						return [];
					});

					const obsGroupEncounters = observations.flatMap((obs) => {
						if (
							obs.resource.encounter &&
							obs.resource.hasMember &&
							obs.resource.hasMember.length > 0
						) {
							const encounterId = String(
								obs.resource.encounter.reference
							).replace("Encounter/", "");

							const searchEncounter = encounters.find(
								(e) => e.resource.id === encounterId
							);
							if (searchEncounter) {
								return {
									resource: {
										episodeOfCare: searchEncounter.resource.episodeOfCare,
										id: obs.resource.id,
										type: obs.resource.code.coding,
										subject: obs.resource.subject,
										serviceProvider: searchEncounter.resource.serviceProvider,
										period: { start: obs.resource.effectiveDateTime },
										resourceType: "Encounter",
									},
								};
							}
						}
						return [];
					});

					observations = [
						...observations.filter(
							(obs) =>
								!obs.resource.hasMember || obs.resource.hasMember.length === 0
						),
						...obsGroups,
					];

					encounters = [...encounters, ...obsGroupEncounters];

					let allResponses = [];

					for (const p of patients) {
						const r = await ctx.call("resources.Patient", {
							["Patient"]: p.resource,
						});

						if (r) {
							allResponses = allResponses.concat(r);
						}
					}

					for (const eoc of eocs) {
						const r = await ctx.call(`resources.EpisodeOfCare`, {
							["EpisodeOfCare"]: eoc.resource,
						});

						if (r) {
							allResponses = allResponses.concat(r);
						}
					}

					for (const encounter of encounters) {
						const r = await ctx.call(`resources.Encounter`, {
							["Encounter"]: encounter.resource,
						});

						if (r) {
							allResponses = allResponses.concat(r);
						}
					}

					for (const obs of observations) {
						const r = await ctx.call(`resources.Observation`, {
							["Observation"]: obs.resource,
						});

						if (r) {
							allResponses = allResponses.concat(r);
						}
					}
					return {
						entry: allResponses,
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
				const { index, ...body } = ctx.params;
				await ctx.call("es.bulk", { index, dataset: [body] });
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
					.filter((o) => !!o.code && !!o["UgEmr Code"])
					.map((ob) => {
						const mappings = [
							{
								system: "UgandaEMR",
								code: ob["UgEmr Code"],
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
				const savedObs = await ctx.call("es.search", {
					index: "concepts",
					body: {
						size: 1000,
						query: {
							match_all: {},
						},
					},
				});

				const processedObs = ctx.params.obs
					.filter((o) => !!o.id && !!o["UgEmr Code"])
					.map((ob) => {
						const previous = savedObs.find(({ id }) => id === ob.id);

						if (previous) {
							const search = previous.mappings.find(
								({ system, code }) =>
									system === "UgandaEMR" &&
									String(code) === String(ob["UgEmr Code"])
							);
							if (search) {
								return previous;
							} else {
								return {
									...previous,
									mappings: [
										...previous.mappings,
										{
											system: "UgandaEMR",
											code: ob["UgEmr Code"],
										},
									],
								};
							}
						}
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
				return await ctx.call("es.bulk", {
					index: "concepts",
					dataset: processedObs,
				});
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
				});
			},
		},
		patient_sync: {
			rest: {
				method: "GET",
				path: "/patient_sync",
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
				});
			},
		},
		synchronize: {
			rest: {
				method: "GET",
				path: "/synchronize",
			},
			async handler(ctx) {
				try {
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
				} catch (error) {
					console.log(error.message);
				}
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

				const stages = programStages.map(
					({
						program: { id: programId, name: programName },
						id,
						name,
						description,
						repeatable,
					}) => {
						const mappings = [
							{
								system: "DHIS2",
								code: id,
							},
						];
						return {
							id,
							name,
							description,
							repeatable,
							programId,
							programName,
							mappings,
						};
					}
				);

				return await Promise.all([
					ctx.call("es.bulk", {
						index: "attributes",
						dataset: attributes,
					}),
					ctx.call("es.bulk", {
						index: "concepts",
						dataset: concepts,
					}),
					ctx.call("es.bulk", {
						index: "entities",
						dataset: entities,
					}),
					ctx.call("es.bulk", {
						index: "programs",
						dataset: progs,
					}),
					ctx.call("es.bulk", {
						index: "stages",
						dataset: stages,
					}),
				]);
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
								type: "bool_prefix",
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
		sql: {
			rest: {
				method: "POST",
				path: "/sql",
			},
			handler(ctx) {
				return ctx.call("es.sql", ctx.params);
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
