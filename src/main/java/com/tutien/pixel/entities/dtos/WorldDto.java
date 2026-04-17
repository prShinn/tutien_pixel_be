package com.tutien.pixel.entities.dtos;

import com.tutien.pixel.entities.enums.loaiMap;
import com.tutien.pixel.entities.monsterEntity;
import com.tutien.pixel.entities.npcEntity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

import java.util.List;

public class WorldDto {
    private int id;
    private String tenMap;
    private String code;
    private int[][] jsonMap;
    private int w;
    private int h;
    private List<PortalDto> portals;
    private List<MonsterDto> monsters;
    private List<npcEntity> npcs;
    private int isDefault;
    @Enumerated(EnumType.STRING)
    private loaiMap loaiMap;

    public WorldDto(int id, String tenMap, String code, int[][] jsonMap, int w, int h, List<PortalDto> portals, List<MonsterDto> monsters, List<npcEntity> npcs, int isDefault, loaiMap loaiMap) {
        this.id = id;
        this.tenMap = tenMap;
        this.code = code;
        this.jsonMap = jsonMap;
        this.w = w;
        this.h = h;
        this.portals = portals;
        this.monsters = monsters;
        this.npcs = npcs;
        this.isDefault = isDefault;
        this.loaiMap = loaiMap;
    }

    public loaiMap getLoaiMap() {
        return loaiMap;
    }

    public void setLoaiMap(loaiMap loaiMap) {
        this.loaiMap = loaiMap;
    }

    public int getIsDefault() {
        return isDefault;
    }

    public void setIsDefault(int isDefault) {
        this.isDefault = isDefault;
    }

    public List<MonsterDto> getMonsters() {
        return monsters;
    }

    public void setMonsters(List<MonsterDto> monsters) {
        this.monsters = monsters;
    }

    public List<npcEntity> getNpcs() {
        return npcs;
    }

    public void setNpcs(List<npcEntity> npcs) {
        this.npcs = npcs;
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
