import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Ellipsis, Mail, RotateCcw, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui";
import { Avatar, AvatarFallback } from "@/ui";
import { Badge } from "@/ui";
import { Button } from "@/ui";
import { Card } from "@/ui";
import { Checkbox } from "@/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui";
import { Input } from "@/ui";
import { useAuth } from "@/features/auth/AuthContext";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type { SpaceMember } from "@/models/interfaces/features/spaces/types";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";

export type MemberAction = { kind: "transfer" | "remove"; member: SpaceMember };
