import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetSettings, useUpdateSettings, useGetBotStatus } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { Save, AlertTriangle } from "lucide-react";

const DEMO_URL = "https://demo-api-capital.backend-capital.com";
const LIVE_URL = "https://api-capital.backend-capital.com";

const settingsSchema = z.object({
  riskPerTrade: z.coerce.number().min(0.1).max(5),
  maxOpenTrades: z.coerce.number().min(1).max(20),
  dailyLossLimit: z.coerce.number().min(1).max(10),
  minRR: z.coerce.number().min(1).max(10),
  minConfidence: z.coerce.number().min(50).max(100),
  useOrderBlocks: z.boolean(),
  useFairValueGaps: z.boolean(),
  useLiquiditySweeps: z.boolean(),
  useBOS: z.boolean(),
  useChoCH: z.boolean(),
  trailingStop: z.boolean(),
  capitalApiKey: z.string().min(1, "API Key is required"),
  capitalIdentifier: z.string().min(1, "Email / identifier is required"),
  capitalPassword: z.string().optional(),
  isDemo: z.boolean(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const { data: status } = useGetBotStatus();

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      riskPerTrade: 1,
      maxOpenTrades: 3,
      dailyLossLimit: 3,
      minRR: 2,
      minConfidence: 65,
      useOrderBlocks: true,
      useFairValueGaps: true,
      useLiquiditySweeps: true,
      useBOS: true,
      useChoCH: false,
      trailingStop: false,
      capitalApiKey: "",
      capitalIdentifier: "",
      capitalPassword: "",
      isDemo: true,
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        riskPerTrade: settings.riskPerTrade,
        maxOpenTrades: settings.maxOpenTrades,
        dailyLossLimit: settings.dailyLossLimit,
        minRR: settings.minRR,
        minConfidence: settings.minConfidence,
        useOrderBlocks: settings.useOrderBlocks,
        useFairValueGaps: settings.useFairValueGaps,
        useLiquiditySweeps: settings.useLiquiditySweeps,
        useBOS: settings.useBOS,
        useChoCH: settings.useChoCH,
        trailingStop: settings.trailingStop,
        capitalApiKey: settings.capitalApiKey,
        capitalIdentifier: settings.capitalIdentifier,
        capitalPassword: "",   // never pre-fill passwords
        isDemo: settings.isDemo,
      });
    }
  }, [settings, form]);

  // Auto-switch URL when isDemo toggles
  const watchIsDemo = form.watch("isDemo");

  const onSubmit = (data: SettingsFormValues) => {
    const payload: Record<string, unknown> = {
      riskPerTrade: data.riskPerTrade,
      maxOpenTrades: data.maxOpenTrades,
      dailyLossLimit: data.dailyLossLimit,
      minRR: data.minRR,
      minConfidence: data.minConfidence,
      useOrderBlocks: data.useOrderBlocks,
      useFairValueGaps: data.useFairValueGaps,
      useLiquiditySweeps: data.useLiquiditySweeps,
      useBOS: data.useBOS,
      useChoCH: data.useChoCH,
      trailingStop: data.trailingStop,
      capitalApiKey: data.capitalApiKey,
      capitalIdentifier: data.capitalIdentifier,
      isDemo: data.isDemo,
      capitalApiUrl: data.isDemo ? DEMO_URL : LIVE_URL,
    };
    // Only send password if the user typed something
    if (data.capitalPassword && data.capitalPassword.trim() !== "") {
      payload.capitalPassword = data.capitalPassword;
    }

    updateSettings.mutate(
      { data: payload as Parameters<typeof updateSettings.mutate>[0]["data"] },
      {
        onSuccess: () => {
          form.setValue("capitalPassword", "");
          toast({ title: "Settings saved successfully" });
        },
        onError: () => {
          toast({ title: "Failed to save settings", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading)
    return (
      <div className="p-8 text-center font-mono text-muted-foreground">
        LOADING_CONFIG...
      </div>
    );

  return (
    <div className="space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-sans">
          System Configuration
        </h1>
        <p className="text-muted-foreground font-mono text-xs mt-1">
          Adjust risk parameters and ICT logic
        </p>
      </div>

      {status?.running && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-sm flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="text-sm">
            <strong>Bot is currently running.</strong> Changes will apply to new
            trades. Consider halting the bot before modifying critical settings.
          </div>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Risk Management */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                Risk Management
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label>Risk per Trade</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {form.watch("riskPerTrade")}%
                  </span>
                </div>
                <Controller
                  name="riskPerTrade"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      min={0.1}
                      max={5}
                      step={0.1}
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label>Max Open Trades</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {form.watch("maxOpenTrades")}
                  </span>
                </div>
                <Controller
                  name="maxOpenTrades"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      min={1}
                      max={20}
                      step={1}
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label>Daily Loss Limit</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {form.watch("dailyLossLimit")}%
                  </span>
                </div>
                <Controller
                  name="dailyLossLimit"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      min={1}
                      max={10}
                      step={0.5}
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label>Min Risk:Reward</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    1:{form.watch("minRR")}
                  </span>
                </div>
                <Controller
                  name="minRR"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      min={1}
                      max={10}
                      step={0.5}
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                    />
                  )}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between">
                  <Label>Min Signal Confidence</Label>
                  <span className="font-mono text-xs text-muted-foreground">
                    {form.watch("minConfidence")}%
                  </span>
                </div>
                <Controller
                  name="minConfidence"
                  control={form.control}
                  render={({ field }) => (
                    <Slider
                      min={50}
                      max={100}
                      step={1}
                      value={[field.value]}
                      onValueChange={([v]) => field.onChange(v)}
                    />
                  )}
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <Label htmlFor="trailingStop" className="cursor-pointer">
                  Trailing Stop
                </Label>
                <Controller
                  name="trailingStop"
                  control={form.control}
                  render={({ field }) => (
                    <Switch
                      id="trailingStop"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* ICT Strategy */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                ICT Strategy Components
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  ["useOrderBlocks", "Order Blocks"],
                  ["useFairValueGaps", "Fair Value Gaps (FVG)"],
                  ["useLiquiditySweeps", "Liquidity Sweeps"],
                  ["useBOS", "Break of Structure (BOS)"],
                  ["useChoCH", "Change of Character (ChoCH)"],
                ] as const
              ).map(([name, label]) => (
                <div key={name} className="flex items-center justify-between">
                  <Label htmlFor={name} className="cursor-pointer">
                    {label}
                  </Label>
                  <Controller
                    name={name}
                    control={form.control}
                    render={({ field }) => (
                      <Switch
                        id={name}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    )}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Broker Integration — full width */}
          <Card className="border-border md:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase text-muted-foreground">
                Broker Integration (Capital.com)
              </CardTitle>
              <CardDescription className="text-xs">
                All three fields are required to start the bot. Passwords are
                never returned to the UI — re-enter to change.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="capitalIdentifier">Login Email</Label>
                  <Input
                    id="capitalIdentifier"
                    type="email"
                    placeholder="your@email.com"
                    {...form.register("capitalIdentifier")}
                    className="font-mono"
                  />
                  {form.formState.errors.capitalIdentifier && (
                    <p className="text-[10px] text-destructive">
                      {form.formState.errors.capitalIdentifier.message}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="capitalApiKey">API Key</Label>
                  <Input
                    id="capitalApiKey"
                    type="password"
                    placeholder={
                      settings?.capitalApiKey === "***"
                        ? "••••••••• (saved)"
                        : "Enter API key"
                    }
                    {...form.register("capitalApiKey")}
                    className="font-mono"
                  />
                  {form.formState.errors.capitalApiKey && (
                    <p className="text-[10px] text-destructive">
                      {form.formState.errors.capitalApiKey.message}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="capitalPassword">
                    Account Password
                    <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                      (leave blank to keep existing)
                    </span>
                  </Label>
                  <Input
                    id="capitalPassword"
                    type="password"
                    placeholder="Enter to update password"
                    {...form.register("capitalPassword")}
                    className="font-mono"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>API Endpoint</Label>
                  <Input
                    value={watchIsDemo ? DEMO_URL : LIVE_URL}
                    readOnly
                    className="font-mono text-xs text-muted-foreground bg-muted/30 cursor-default"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2 border-t border-border">
                <Controller
                  name="isDemo"
                  control={form.control}
                  render={({ field }) => (
                    <Switch
                      id="isDemo"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
                <div className="space-y-0.5 flex-1">
                  <Label htmlFor="isDemo" className="cursor-pointer">
                    Demo Account Mode
                  </Label>
                  <CardDescription className="text-xs">
                    {watchIsDemo
                      ? "Trades routed to Capital.com DEMO environment (safe for testing)"
                      : "⚠️ Trades routed to Capital.com LIVE environment — real money at risk"}
                  </CardDescription>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={updateSettings.isPending}
            className="w-full sm:w-auto font-mono text-xs"
          >
            <Save className="mr-2 h-4 w-4" />
            COMMIT_CHANGES
          </Button>
        </div>
      </form>
    </div>
  );
}
