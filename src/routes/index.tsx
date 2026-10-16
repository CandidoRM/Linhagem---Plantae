import { createFileRoute } from "@tanstack/react-router";
import { FloraCatalog } from "@/components/flora-catalog";

export const Route = createFileRoute("/")({ component: FloraCatalog });
