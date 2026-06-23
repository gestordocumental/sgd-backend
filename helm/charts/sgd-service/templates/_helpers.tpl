{{/*
Full name: use fullnameOverride if set, otherwise the release name.
Install with: helm install auth-service helm/charts/sgd-service --values ...
Then {{ include "sgd-service.fullname" . }} == "auth-service".
*/}}
{{- define "sgd-service.fullname" -}}
{{- if .Values.fullnameOverride -}}
  {{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
  {{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "sgd-service.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "sgd-service.labels" -}}
helm.sh/chart: {{ include "sgd-service.chart" . }}
{{ include "sgd-service.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "sgd-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sgd-service.fullname" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
