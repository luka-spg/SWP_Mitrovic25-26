import { PrismaClient } from "./prisma/client/client.ts";
import { faker } from "@faker-js/faker";

const prisma = new PrismaClient();

console.log("Start seeding large dataset (this can take several minutes)...");

// Helpers
function sample<T>(arr: T[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function chunk<T>(array: T[], size: number) {
    const res: T[][] = [];
    for (let i = 0; i < array.length; i += size) res.push(array.slice(i, i + size));
    return res;
}

// Config
const AIRPORT_COUNT = 20;
const PLANE_COUNT = 20;
const PASSENGER_COUNT = 20000;
const FLIGHT_COUNT = 2500;

// 1) Airports (idempotent: only create missing)
const existingAirports = await prisma.airport.findMany({ select: { id: true, iataCode: true } });
const airportData: { id: string; iataCode: string }[] = existingAirports as { id: string; iataCode: string }[];
const airportsToCreate = Math.max(0, AIRPORT_COUNT - airportData.length);
for (let i = 0; i < airportsToCreate; i++) {
    let fa = faker.airline.airport();
    let iata = fa.iataCode || faker.string.alpha(3).toUpperCase();
    while (
        airportData.some((a) => a.iataCode === iata) ||
        (await prisma.airport.findUnique({ where: { iataCode: iata } })) !== null
    ) {
        fa = faker.airline.airport();
        iata = fa.iataCode || faker.string.alpha(3).toUpperCase();
    }
    const created = await prisma.airport.create({ data: { name: fa.name, iataCode: iata, city: faker.location.city() } });
    airportData.push({ id: created.id, iataCode: created.iataCode });
}
console.log(`Total airports now: ${airportData.length}`);

// 2) Planes
const planeModels = ["A320", "A321", "B737", "B777", "A330", "Embraer E195", "A350", "B787"];
// 2) Planes (idempotent)
const existingPlanes = await prisma.plane.findMany({ select: { id: true, model: true, capacity: true } });
const planeData = existingPlanes as { id: string; model: string; capacity: number }[];
const planesToCreate = Math.max(0, PLANE_COUNT - planeData.length);
for (let i = 0; i < planesToCreate; i++) {
    const model = planeModels[(planeData.length + i) % planeModels.length];
    const capacity = faker.number.int({ min: 80, max: 400 });
    const created = await prisma.plane.create({ data: { model, capacity } });
    planeData.push({ id: created.id, model, capacity });
}
console.log(`Total planes now: ${planeData.length}`);

// 3) Passengers (batch createMany)
console.log(`Creating ${PASSENGER_COUNT} passengers in batches...`);
const passengerChunkSize = 2000;
const existingPassengerCount = await prisma.passenger.count();
const passengersToCreate = Math.max(0, PASSENGER_COUNT - existingPassengerCount);
for (let start = 0; start < passengersToCreate; start += passengerChunkSize) {
    const batch: { firstName: string; lastName: string; email: string }[] = [];
    const end = Math.min(passengersToCreate, start + passengerChunkSize);
    for (let i = start; i < end; i++) {
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        // ensure unique-ish email by appending index
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${existingPassengerCount + i}@example.com`;
        batch.push({ firstName, lastName, email });
    }
    await prisma.passenger.createMany({ data: batch });
    console.log(`  inserted passengers ${start + 1} - ${end}`);
}
const passengerIds = (await prisma.passenger.findMany({ select: { id: true } }) as { id: string }[]).map((p) => p.id);
console.log(`Total passengers now: ${passengerIds.length}`);

// 4) Flights and connect passengers
console.log(`Creating ${FLIGHT_COUNT} flights and attaching passengers...`);
// 4) Flights (idempotent)
const existingFlightCount = await prisma.flight.count();
const flightsToCreate = Math.max(0, FLIGHT_COUNT - existingFlightCount);
const flightsPerBatch = 50;
for (let batchStart = 0; batchStart < flightsToCreate; batchStart += flightsPerBatch) {
    const batchEnd = Math.min(flightsToCreate, batchStart + flightsPerBatch);
    const ops: Promise<any>[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
        // origin/destination
        let origin = sample(airportData);
        let destination = sample(airportData);
        while (destination.id === origin.id) destination = sample(airportData);

        const plane = sample(planeData);
        const departure = faker.date.future({ years: 1, refDate: new Date() });
        const arrival = new Date(departure.getTime() + faker.number.int({ min: 1, max: 12 }) * 60 * 60 * 1000);

        // pick random passengers for flight (up to plane capacity, but not huge)
        const pCount = faker.number.int({ min: 10, max: Math.min(200, plane.capacity) });
        const picked: string[] = [];
        for (let p = 0; p < pCount; p++) picked.push(sample(passengerIds));

        ops.push(
            prisma.flight.create({
                data: {
                    flightNumber: `${plane.model}-${faker.string.numeric(5)}`,
                    departureTime: departure,
                    arrivalTime: arrival,
                    origin: { connect: { id: origin.id } },
                    destination: { connect: { id: destination.id } },
                    plane: { connect: { id: plane.id } },
                    passengers: { connect: picked.map((id) => ({ id })) },
                },
            })
        );
    }
    await Promise.all(ops);
    console.log(`  created flights ${batchStart + 1} - ${batchEnd}`);
}

console.log(`Total flights now: ${await prisma.flight.count()}`);

await prisma.$disconnect();
console.log("Seeding finished.");
