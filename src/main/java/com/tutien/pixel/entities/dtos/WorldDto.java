package com.tutien.pixel.entities.dtos;

import java.util.List;

public class WorldDto {
    private int id;
    private String tenMap;
    private String code;
    private int[][] jsonMap;
    private int w;
    private int h;
    private List<PortalDto> portals;

    public WorldDto(int id, String tenMap, String code, int[][] jsonMap, int w, int h, List<PortalDto> portals) {
        this.id = id;
        this.tenMap = tenMap;
        this.code = code;
        this.jsonMap = jsonMap;
        this.w = w;
        this.h = h;
        this.portals = portals;
    }

    public List<PortalDto> getPortals() {
        return portals;
    }

    public void setPortals(List<PortalDto> portals) {
        this.portals = portals;
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getTenMap() {
        return tenMap;
    }

    public void setTenMap(String tenMap) {
        this.tenMap = tenMap;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public int[][] getJsonMap() {
        return jsonMap;
    }

    public void setJsonMap(int[][] jsonMap) {
        this.jsonMap = jsonMap;
    }

    public int getW() {
        return w;
    }

    public void setW(int w) {
        this.w = w;
    }

    public int getH() {
        return h;
    }

    public void setH(int h) {
        this.h = h;
    }
}
